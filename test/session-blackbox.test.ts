import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { brain } from "../src/state/files.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import { readSessionRecord, sessionFile } from "../src/state/session.js";
import { readLedger } from "../src/cost/ledger.js";

/**
 * Black-box tests: run the COMPILED CommonJS hooks (dist/hooks/*.js) with real
 * stdin payloads, exactly as an installed project would. Requires `pnpm build`
 * first; skips otherwise so `vitest` alone still passes.
 */
const distHooks = path.resolve("dist/hooks");
const built = fs.existsSync(path.join(distHooks, "session-start.js"));

function setup(): { dir: string; hooksDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-bb-"));
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "state", "sessions"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.knowledge, "# Knowledge\n");
  fs.writeFileSync(b.solutions, "[]");
  const hooksDir = b.hooksDir;
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of fs.readdirSync(distHooks)) {
    fs.copyFileSync(path.join(distHooks, f), path.join(hooksDir, f));
  }
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  return { dir, hooksDir };
}

function run(hooksDir: string, name: string, stdin: unknown, dir: string): void {
  execFileSync("node", [path.join(hooksDir, name)], {
    input: JSON.stringify(stdin),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PACKMIND_ROOT: dir },
    timeout: 5000,
  });
}

function runAsync(hooksDir: string, name: string, stdin: unknown, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [path.join(hooksDir, name)], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PACKMIND_ROOT: dir },
    });
    p.on("exit", () => resolve());
    p.on("error", reject);
    p.stdin.end(JSON.stringify(stdin));
  });
}

/** A Write tool call payload for post-write, writing the file to disk first. */
function writeFile(dir: string, rel: string, content: string): Record<string, unknown> {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { tool_name: "Write", tool_input: { file_path: rel, content }, session_id: "" };
}

describe.skipIf(!built)("[P1] black-box session lifecycle (compiled hooks)", () => {
  it("two concurrent session ids keep independent per-session files", () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S-A", source: "startup" }, dir);
    run(hooksDir, "session-start.js", { session_id: "S-B", source: "startup" }, dir);

    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/a.ts", "A"), session_id: "S-A" }, dir);
    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/b.ts", "B"), session_id: "S-B" }, dir);

    const a = readSessionRecord(dir, "S-A")!;
    const b = readSessionRecord(dir, "S-B")!;
    expect(a.writes.map((w) => w.file)).toEqual(["src/a.ts"]);
    expect(b.writes.map((w) => w.file)).toEqual(["src/b.ts"]); // no cross-contamination
    expect(a.id).not.toBe(b.id);
  });

  it("/clear folds the old incarnation into the ledger and starts a fresh one", () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/a.ts", "A"), session_id: "S1" }, dir);
    const before = readSessionRecord(dir, "S1")!;
    expect(before.writes).toHaveLength(1);

    run(hooksDir, "session-start.js", { session_id: "S1", source: "clear" }, dir);

    const ledger = readLedger(dir, "m");
    expect(ledger.sessions.map((r) => r.id)).toContain(before.id); // old folded
    const after = readSessionRecord(dir, "S1")!;
    expect(after.id).not.toBe(before.id); // new incarnation
    expect(after.writes).toHaveLength(0); // fresh counters
  });

  it("resume suspends then reactivates without losing counters", () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/a.ts", "A"), session_id: "S1" }, dir);

    run(hooksDir, "session-end.js", { session_id: "S1", reason: "resume" }, dir);
    const suspended = readSessionRecord(dir, "S1")!;
    expect(suspended.status).toBe("suspended");
    expect(fs.existsSync(sessionFile(dir, "S1"))).toBe(true); // kept, it will resume
    expect(suspended.writes).toHaveLength(1);

    run(hooksDir, "session-start.js", { session_id: "S1", source: "resume" }, dir);
    const resumed = readSessionRecord(dir, "S1")!;
    expect(resumed.status).toBe("active");
    expect(resumed.id).toBe(suspended.id); // same incarnation
    expect(resumed.writes).toHaveLength(1); // preserved
  });

  it("compact reattaches without resetting", () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/a.ts", "A"), session_id: "S1" }, dir);
    const id = readSessionRecord(dir, "S1")!.id;

    run(hooksDir, "session-start.js", { session_id: "S1", source: "compact" }, dir);
    const after = readSessionRecord(dir, "S1")!;
    expect(after.id).toBe(id);
    expect(after.writes).toHaveLength(1);
  });

  it("terminal end folds then removes the live file", () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    run(hooksDir, "post-write.js", { ...writeFile(dir, "src/a.ts", "A"), session_id: "S1" }, dir);
    const id = readSessionRecord(dir, "S1")!.id;

    run(hooksDir, "session-end.js", { session_id: "S1", reason: "logout" }, dir);
    expect(fs.existsSync(sessionFile(dir, "S1"))).toBe(false); // removed
    expect(readLedger(dir, "m").sessions.map((r) => r.id)).toContain(id); // but folded
  });

  it("concurrent hook processes on one session lose no writes (lock contention)", async () => {
    const { dir, hooksDir } = setup();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    const N = 6;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runAsync(hooksDir, "post-write.js", { ...writeFile(dir, `src/f${i}.ts`, `x${i}`), session_id: "S1" }, dir),
      ),
    );

    const rec = readSessionRecord(dir, "S1")!;
    expect(rec.writes).toHaveLength(N); // every locked update landed
  });
});
