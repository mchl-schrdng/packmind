import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { startDashboard, type DashboardHandle } from "../src/dashboard/server.js";
import { brain } from "../src/state/files.js";
import { updateSession } from "../src/state/session.js";
import { updateChangeSet, emptyChangeSet, recordCandidate } from "../src/change/store.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

describe("[P1] dashboard /api/changes", () => {
  let root: string;
  let handle: DashboardHandle;
  let base: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dashch-"));
    fs.mkdirSync(path.join(brain(root).dir, "state", "sessions"), { recursive: true });
    fs.writeFileSync(brain(root).config, JSON.stringify(DEFAULT_CONFIG));
    // One active session with a change.
    updateSession(root, "S1", (s) => { s.status = "active"; s.sessionId = "S1"; });
    updateChangeSet(root, "S1", emptyChangeSet({ incarnationId: "S1", sessionId: "S1", root, baselineCreatedAt: "t0" }), (cs) => {
      recordCandidate(cs, { path: "src/a.ts", kind: "modify" }, "post-tool", "t1");
    });
    handle = await startDashboard(root, 7941);
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(() => {
    handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns active sessions with their change sets", async () => {
    const res = await fetch(`${base}/api/changes?token=${handle.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<{ id: string; changeSet: { changes: Record<string, unknown> } }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("S1");
    expect(Object.keys(body.sessions[0].changeSet.changes)).toContain("src/a.ts");
  });

  it("requires the API token", async () => {
    const res = await fetch(`${base}/api/changes`);
    expect(res.status).toBe(401);
  });
});
