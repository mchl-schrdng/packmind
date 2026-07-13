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
import { runDoctor } from "../src/cli/doctor.js";
import { registerProject } from "../src/cli/registry.js";
import { blockTicket, tryAcquireLaunch, readTicket, ticketFile } from "../src/state/resume.js";

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

  it("release() only removes a lock it still owns (doctor --fix + new maintain scenario)", () => {
    const root = project();
    const zombie = acquireMaintainLock(root)!;
    // doctor --fix removed the zombie's stale lock...
    fs.rmSync(maintainLockDir(root), { recursive: true, force: true });
    // ...and a NEW maintain acquired its own.
    const current = acquireMaintainLock(root)!;
    // The zombie finishing must NOT delete the current owner's lock.
    zombie.release();
    expect(fs.existsSync(maintainLockDir(root))).toBe(true);
    expect(acquireMaintainLock(root)).toBeNull(); // still exclusively held
    current.release();
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

  it("1 on corrupted config.json, without mutating anything (no silent defaults)", async () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".packmind", "config.json"), "{ not json !!");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = fs.readdirSync(path.join(root, ".packmind"));
    expect(await run(root, { quiet: true })).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toMatch(/config\.json/);
    expect(fs.readdirSync(path.join(root, ".packmind"))).toEqual(before); // no map.md created
    expect(fs.existsSync(maintainLockDir(root))).toBe(false);
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

describe("doctor --fix", () => {
  it("removes a maintain lock older than six hours, keeps a fresh one", () => {
    const staleRoot = project();
    const freshRoot = project();
    registerProject(staleRoot, "1.0.0");
    registerProject(freshRoot, "1.0.0");
    for (const root of [staleRoot, freshRoot]) {
      const dir = maintainLockDir(root);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "lock.json"), JSON.stringify({ pid: 1, startedAt: "x", owner: "o" }));
    }
    const old = new Date(Date.now() - 7 * 3600 * 1000);
    fs.utimesSync(maintainLockDir(staleRoot), old, old);

    vi.spyOn(console, "log").mockImplementation(() => {});
    runDoctor({ fix: true });
    expect(fs.existsSync(maintainLockDir(staleRoot))).toBe(false);
    expect(fs.existsSync(maintainLockDir(freshRoot))).toBe(true);

    // without --fix, nothing is ever removed
    const dir = maintainLockDir(freshRoot);
    fs.utimesSync(dir, old, old);
    runDoctor({});
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("resets a launching resume ticket older than six hours back to blocked", () => {
    const root = project();
    registerProject(root, "1.0.0");
    const staleAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    const freshAt = new Date().toISOString();
    blockTicket(root, "stale", staleAt);
    expect(tryAcquireLaunch(root, "stale", staleAt)).toBe(true);
    blockTicket(root, "fresh", freshAt);
    expect(tryAcquireLaunch(root, "fresh", freshAt)).toBe(true);
    // Age comes from updatedAt inside the ticket, set above via `now` params.
    fs.writeFileSync(ticketFile(root, "stale"), JSON.stringify({ ...readTicket(root, "stale"), updatedAt: staleAt }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    runDoctor({}); // without --fix: reported, untouched
    expect(readTicket(root, "stale")!.status).toBe("launching");

    runDoctor({ fix: true });
    expect(readTicket(root, "stale")!.status).toBe("blocked"); // recoverable again
    expect(readTicket(root, "fresh")!.status).toBe("launching"); // fresh one kept
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
