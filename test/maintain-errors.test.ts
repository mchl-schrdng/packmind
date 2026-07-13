import { describe, it, expect, vi, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMaintain } from "../src/cli/maintain-cmd.js";
import { EmbedderUnavailableError } from "../src/recall/embedder.js";
import { refreshFromQueue } from "../src/recall/indexer.js";
import { reconcileAndSync } from "../src/change/service.js";

// Force the failure modes maintain must surface: module-mock the recall queue
// and the reconciler (real implementations are covered by their own suites).
vi.mock("../src/recall/indexer.js", () => ({ refreshFromQueue: vi.fn() }));
vi.mock("../src/change/service.js", () => ({ reconcileAndSync: vi.fn() }));

function project(recallEnabled: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-maintain-err-"));
  fs.mkdirSync(path.join(root, ".packmind", "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".packmind", "config.json"),
    JSON.stringify({ recall: { enabled: recallEnabled } }),
  );
  return root;
}
async function run(root: string, opts: Record<string, unknown> = {}) {
  const prev = process.env.PACKMIND_ROOT;
  process.env.PACKMIND_ROOT = root;
  try { return await runMaintain(opts); }
  finally { prev === undefined ? delete process.env.PACKMIND_ROOT : process.env.PACKMIND_ROOT = prev; }
}
function addActiveSession(root: string): void {
  const dir = path.join(root, ".packmind", "state", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "abcd.json"),
    JSON.stringify({ id: "inc-1", sessionId: "s-1", status: "active", lastEventAt: new Date().toISOString() }),
  );
}
afterEach(() => vi.restoreAllMocks());

describe("maintain surfaces failures instead of masking them", () => {
  it("a missing optional embedder is a visible stderr warning, NOT a failure (exit 0)", async () => {
    const root = project(true);
    vi.mocked(refreshFromQueue).mockRejectedValue(new EmbedderUnavailableError("needs @xenova/transformers"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run(root, { quiet: true })).toBe(0);
    expect(err.mock.calls.flat().join("\n")).toMatch(/recall skipped/i); // stderr, so --quiet can't hide it
    expect(log).not.toHaveBeenCalled();
  });

  it("a real recall error is a step failure: exit 2 and backups are not pruned", async () => {
    const root = project(true);
    vi.mocked(refreshFromQueue).mockRejectedValue(new Error("vector store corrupted"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(root, { quiet: true })).toBe(2);
    const all = err.mock.calls.flat().join("\n");
    expect(all).toMatch(/recall queue failed/i);
    expect(all).toMatch(/backups NOT pruned/i);
  });

  it("a session that fails to reconcile is a step failure with the session named on stderr", async () => {
    const root = project(false);
    addActiveSession(root);
    vi.mocked(reconcileAndSync).mockImplementation(() => { throw new Error("baseline unreadable"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(root, { quiet: true })).toBe(2);
    const all = err.mock.calls.flat().join("\n");
    expect(all).toContain("inc-1");
    expect(all).toMatch(/backups NOT pruned/i);
  });
});
