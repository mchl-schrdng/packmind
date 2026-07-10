import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { startDashboard, type DashboardHandle } from "../src/dashboard/server.js";
import { brain } from "../src/state/files.js";
import { readJsonOr } from "../src/util/fs-atomic.js";
import type { Rule } from "../src/guard/policy.js";

/**
 * The hooks read guard.effective.json (not policy.json) and recall reads the
 * vector index (fed by the queue). A dashboard save that only writes the primary
 * file leaves runtime behavior stale. Drive the real server and assert the
 * derived state is regenerated too.
 */
describe("[P1] dashboard mutations regenerate derived state", () => {
  let root: string;
  let handle: DashboardHandle;
  let base: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dash-deriv-"));
    fs.mkdirSync(path.join(root, ".packmind", "recall"), { recursive: true });
    fs.writeFileSync(path.join(root, ".packmind", "knowledge.md"), "# Knowledge\n\noriginal\n");
    handle = await startDashboard(root, 7931);
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(() => {
    handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("POST /api/policy regenerates guard.effective.json (what the hooks read)", async () => {
    const rule: Rule = { id: "no-foo", message: "no foo here", severity: "warn", content: "foo" };
    const res = await fetch(`${base}/api/policy?token=${handle.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: [rule] }),
    });
    expect(res.status).toBe(200);

    const eff = readJsonOr<{ rules?: Rule[] }>(brain(root).effective, { rules: [] });
    expect((eff.rules ?? []).some((r) => r.id === "no-foo")).toBe(true);
  });

  it("POST /api/knowledge enqueues it for recall", async () => {
    const res = await fetch(`${base}/api/knowledge?token=${handle.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "# Knowledge\n\nedited\n" }),
    });
    expect(res.status).toBe(200);

    const queue = readJsonOr<string[]>(brain(root).queue, []);
    expect(queue).toContain(".packmind/knowledge.md");
  });
});
