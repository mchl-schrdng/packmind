import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { decideResume, selectTicket, runResume } from "../src/cli/resume-cmd.js";
import { blockTicket, readTicket, type ResumeTicketV1 } from "../src/state/resume.js";

const NOW = Date.parse("2026-07-13T10:00:00.000Z");
const PAST = "2026-07-13T09:00:00.000Z";
const FUTURE = "2026-07-13T11:00:00.000Z";

function ticket(over: Partial<ResumeTicketV1> = {}): ResumeTicketV1 {
  return {
    version: 1, sessionId: "s1", status: "blocked",
    createdAt: PAST, updatedAt: PAST, reconcileRequested: true, ...over,
  };
}

describe("decideResume", () => {
  it("reset already passed -> immediate launch, no warning", () => {
    expect(decideResume(ticket({ resetAt: PAST }), NOW, false)).toEqual({ kind: "launch", warnUnknownReset: false });
    expect(decideResume(ticket({ resetAt: PAST }), NOW, true)).toEqual({ kind: "launch", warnUnknownReset: false });
  });
  it("future reset without --wait -> print the time, launch nothing", () => {
    expect(decideResume(ticket({ resetAt: FUTURE }), NOW, false)).toEqual({ kind: "print-reset", resetAt: FUTURE });
  });
  it("future reset with --wait -> foreground countdown", () => {
    expect(decideResume(ticket({ resetAt: FUTURE }), NOW, true)).toEqual({ kind: "wait", resetAt: FUTURE });
  });
  it("unknown reset with --wait -> never launch, ask to retry after the limit", () => {
    expect(decideResume(ticket(), NOW, true)).toEqual({ kind: "unknown-wait" });
  });
  it("unknown reset without --wait -> warn then launch (explicit user action)", () => {
    expect(decideResume(ticket(), NOW, false)).toEqual({ kind: "launch", warnUnknownReset: true });
  });
});

describe("selectTicket", () => {
  it("zero tickets -> clear error", () => {
    expect(selectTicket([], undefined)).toHaveProperty("error");
  });
  it("one ticket -> auto-selected", () => {
    const t = ticket();
    expect(selectTicket([t], undefined)).toEqual({ ticket: t });
  });
  it("several tickets without --session -> error listing ids", () => {
    const r = selectTicket([ticket({ sessionId: "a" }), ticket({ sessionId: "b" })], undefined);
    expect((r as { error: string }).error).toContain("a");
    expect((r as { error: string }).error).toContain("b");
  });
  it("--session picks the exact ticket; unknown id -> error", () => {
    const a = ticket({ sessionId: "a" });
    expect(selectTicket([a, ticket({ sessionId: "b" })], "a")).toEqual({ ticket: a });
    expect(selectTicket([a], "zz")).toHaveProperty("error");
  });
});

// --- runResume against a real ticket dir, fake clock, stub spawner ----------
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-resume-cmd-"));
  fs.mkdirSync(path.join(root, ".packmind"), { recursive: true });
  fs.writeFileSync(path.join(root, ".packmind", "config.json"), "{}");
  return root;
}
function fakeDeps(clockMs: number) {
  const spawned: string[] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  let clock = clockMs;
  return {
    spawned, logs, errs,
    deps: {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      spawnClaude: async (sessionId: string) => { spawned.push(sessionId); return { ok: true as const }; },
      log: (m: string) => logs.push(m),
      err: (m: string) => errs.push(m),
      onInterrupt: (_fn: () => void) => () => {},
    },
  };
}
async function run(root: string, opts: Record<string, unknown>, f: ReturnType<typeof fakeDeps>) {
  const prev = process.env.PACKMIND_ROOT;
  process.env.PACKMIND_ROOT = root;
  try { return await runResume(opts, f.deps); }
  finally { prev === undefined ? delete process.env.PACKMIND_ROOT : process.env.PACKMIND_ROOT = prev; }
}

describe("runResume", () => {
  it("no ticket -> clear message on stderr and exit 1", async () => {
    const root = project();
    const f = fakeDeps(NOW);
    expect(await run(root, {}, f)).toBe(1);
    expect(f.errs.join("\n")).toMatch(/no resume ticket/i);
    expect(f.spawned).toEqual([]);
  });

  it("reset passed -> asks to close the old Claude, launches exactly once", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, PAST);
    const f = fakeDeps(NOW);
    expect(await run(root, {}, f)).toBe(0);
    expect(f.logs.join("\n")).toContain("Fermez l'ancien processus Claude avant de continuer.");
    expect(f.spawned).toEqual(["s1"]);
  });

  it("future reset without --wait -> shows the time, launches nothing, exit 0", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, FUTURE);
    const f = fakeDeps(NOW);
    expect(await run(root, {}, f)).toBe(0);
    expect(f.logs.join("\n")).toContain(FUTURE);
    expect(f.spawned).toEqual([]);
    expect(readTicket(root, "s1")!.status).toBe("blocked"); // ticket kept
  });

  it("--wait launches after the reset with a simulated clock", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, FUTURE);
    const f = fakeDeps(NOW); // fake sleep advances the clock past FUTURE
    expect(await run(root, { wait: true }, f)).toBe(0);
    expect(f.spawned).toEqual(["s1"]);
  });

  it("unknown reset with --wait -> no launch, retry-later message, exit 1", async () => {
    const root = project();
    blockTicket(root, "s1", PAST);
    const f = fakeDeps(NOW);
    expect(await run(root, { wait: true }, f)).toBe(1);
    expect(f.spawned).toEqual([]);
    expect(readTicket(root, "s1")!.status).toBe("blocked");
  });

  it("unknown reset without --wait -> warns then launches (explicit user action)", async () => {
    const root = project();
    blockTicket(root, "s1", PAST);
    const f = fakeDeps(NOW);
    expect(await run(root, {}, f)).toBe(0);
    expect(f.spawned).toEqual(["s1"]);
    expect(f.logs.join("\n") + f.errs.join("\n")).toMatch(/unknown/i);
  });

  it("interrupt during the countdown -> nothing launched, ticket kept", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, FUTURE);
    const f = fakeDeps(NOW);
    // Interrupt immediately: registering the handler fires it on first wait tick.
    f.deps.onInterrupt = (fn: () => void) => { fn(); return () => {}; };
    expect(await run(root, { wait: true }, f)).toBe(130);
    expect(f.spawned).toEqual([]);
    expect(readTicket(root, "s1")!.status).toBe("blocked");
  });

  it("two concurrent resumes launch exactly one Claude", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, PAST);
    const f1 = fakeDeps(NOW);
    const f2 = fakeDeps(NOW);
    // Hold the first spawn open so the second command runs while ticket=launching.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    f1.deps.spawnClaude = async (sid: string) => { f1.spawned.push(sid); await gate; return { ok: true as const }; };
    const p1 = run(root, {}, f1);
    // Wait until p1 actually holds the launch (ticket = launching).
    for (let i = 0; i < 100 && readTicket(root, "s1")!.status !== "launching"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const code2 = await run(root, {}, f2);
    release();
    expect(await p1).toBe(0);
    expect(code2).toBe(1);
    expect(f1.spawned).toEqual(["s1"]);
    expect(f2.spawned).toEqual([]);
  });

  it("a spawn error keeps a recoverable (blocked) ticket and exits 1", async () => {
    const root = project();
    blockTicket(root, "s1", PAST, PAST);
    const f = fakeDeps(NOW);
    f.deps.spawnClaude = async () => ({ ok: false as const, error: "claude not found in PATH" }) as { ok: true } | { ok: false; error: string };
    expect(await run(root, {}, f)).toBe(1);
    expect(readTicket(root, "s1")!.status).toBe("blocked");
  });
});
