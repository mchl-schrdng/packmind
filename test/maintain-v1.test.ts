import { describe, it, expect, vi, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import {
  parseKeepBackups,
  maintainLockDir,
  acquireMaintainLock,
  runMaintain,
} from "../src/cli/maintain-cmd.js";
import { pruneStaleSessions } from "../src/state/session.js";

// ESM namespaces aren't spyable in place; spy-mock the whole module (real
// implementations still run) so the never-spawns test can observe calls.
vi.mock("node:child_process", { spy: true });

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-maintain-"));
  fs.mkdirSync(path.join(root, ".packmind", "state"), { recursive: true });
  // Minimal valid config; recall disabled keeps runs fast and dependency-free.
  fs.writeFileSync(path.join(root, ".packmind", "config.json"), JSON.stringify({ recall: { enabled: false } }));
  return root;
}
async function run(root: string, opts: Record<string, unknown> = {}) {
  const prev = process.env.PACKMIND_ROOT;
  process.env.PACKMIND_ROOT = root;
  try { return await runMaintain(opts); }
  finally { prev === undefined ? delete process.env.PACKMIND_ROOT : process.env.PACKMIND_ROOT = prev; }
}
afterEach(() => vi.restoreAllMocks());

describe("parseKeepBackups validates BEFORE any mutation", () => {
  it("accepts integers 1..1000 and defaults to 10", () => {
    expect(parseKeepBackups(undefined)).toBe(10);
    expect(parseKeepBackups("1")).toBe(1);
    expect(parseKeepBackups("1000")).toBe(1000);
  });
  it.each(["0", "-1", "1.5", "abc", "10abc", "", "1001"])("rejects %j", (raw) => {
    expect(parseKeepBackups(raw)).toBeNull();
  });
});

describe("maintain lock", () => {
  it("creates .packmind/state/maintain.lock/ with pid/startedAt/owner and releases it", () => {
    const root = project();
    const lock = acquireMaintainLock(root)!;
    const meta = JSON.parse(fs.readFileSync(path.join(maintainLockDir(root), "lock.json"), "utf8"));
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.startedAt).toBe("string");
    expect(typeof meta.owner).toBe("string");
    expect(acquireMaintainLock(root)).toBeNull(); // never two at once, never stolen
    lock.release();
    expect(fs.existsSync(maintainLockDir(root))).toBe(false);
  });
});

describe("runMaintain exit codes", () => {
  it("0 on success (quiet run prints nothing)", async () => {
    const root = project();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run(root, { quiet: true })).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(fs.existsSync(maintainLockDir(root))).toBe(false); // released in finally
  });

  it("1 on invalid --keep-backups, without mutating anything", async () => {
    const root = project();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = fs.readdirSync(path.join(root, ".packmind"));
    expect(await run(root, { keepBackups: "0", quiet: true })).toBe(1);
    expect(err).toHaveBeenCalled(); // errors always visible, even with --quiet
    expect(fs.readdirSync(path.join(root, ".packmind"))).toEqual(before); // no mutation
    expect(fs.existsSync(maintainLockDir(root))).toBe(false); // lock never taken
  });

  it("3 when another maintenance holds the lock", async () => {
    const root = project();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const lock = acquireMaintainLock(root)!;
    try {
      expect(await run(root, { quiet: true })).toBe(3);
      expect(err).toHaveBeenCalled();
    } finally { lock.release(); }
  });

  it("2 on partial failure, errors on stderr even with --quiet, lock released", async () => {
    const root = project();
    // Force the map step to fail: map.md as a directory breaks the atomic rename.
    fs.mkdirSync(path.join(root, ".packmind", "map.md"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(root, { quiet: true })).toBe(2);
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls.flat().join("\n")).toMatch(/backups NOT pruned/i);
    expect(fs.existsSync(maintainLockDir(root))).toBe(false); // still released
  });

  it("never launches Claude and never spawns anything", async () => {
    const root = project();
    vi.clearAllMocks();
    expect(await run(root, { quiet: true })).toBe(0);
    expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.execFile)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.execFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(childProcess.exec)).not.toHaveBeenCalled();
  });
});

describe("session retention", () => {
  it("a suspended session is NEVER deleted, whatever its age", () => {
    const root = project();
    const dir = path.join(root, ".packmind", "state", "sessions");
    fs.mkdirSync(dir, { recursive: true });
    const old = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(path.join(dir, "aaaa.json"), JSON.stringify({ id: "a", status: "suspended", lastEventAt: old }));
    fs.writeFileSync(path.join(dir, "bbbb.json"), JSON.stringify({ id: "b", status: "active", lastEventAt: old }));
    fs.writeFileSync(path.join(dir, "cccc.json"), JSON.stringify({ id: "c", lastEventAt: old })); // finalized leftover
    const removed = pruneStaleSessions(root, 14 * 24 * 3600 * 1000);
    expect(removed).toBe(1);
    expect(fs.existsSync(path.join(dir, "aaaa.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "bbbb.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "cccc.json"))).toBe(false);
  });
});
