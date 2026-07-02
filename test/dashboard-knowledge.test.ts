import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { startDashboard, type DashboardHandle } from "../src/dashboard/server.js";

/**
 * Regression for the "Save knowledge" bug: a method-agnostic GET on
 * /api/knowledge used to shadow the POST writer, so saves silently no-opped.
 * Drive the real server over HTTP and assert the POST actually writes.
 */
describe("dashboard /api/knowledge POST", () => {
  let root: string;
  let handle: DashboardHandle;
  let base: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dash-"));
    fs.mkdirSync(path.join(root, ".packmind"), { recursive: true });
    fs.writeFileSync(path.join(root, ".packmind", "knowledge.md"), "# Knowledge\n\noriginal\n");
    handle = await startDashboard(root, 7913);
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(() => {
    handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const kfile = () => path.join(root, ".packmind", "knowledge.md");

  it("writes knowledge.md on POST (POST is not shadowed by the GET handler)", async () => {
    const res = await fetch(`${base}/api/knowledge?token=${handle.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "# Knowledge\n\nedited via dashboard\n" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fs.readFileSync(kfile(), "utf8")).toContain("edited via dashboard");
  });

  it("still serves the current text on GET", async () => {
    const res = await fetch(`${base}/api/knowledge?token=${handle.token}`);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain("edited via dashboard");
  });
});
