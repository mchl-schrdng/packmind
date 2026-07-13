import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { extractResetAt } from "../src/hooks/runtime.js";
import { readTicket, ticketFile, blockTicket, tryAcquireLaunch } from "../src/state/resume.js";

const NOW = Date.parse("2026-07-13T10:00:00.000Z");

describe("extractResetAt never invents a reset time", () => {
  it("returns undefined when nothing usable is present", () => {
    expect(extractResetAt({}, NOW)).toBeUndefined();
    expect(extractResetAt({ error: "rate_limit" }, NOW)).toBeUndefined();
    expect(extractResetAt({ reset_at: "soon" }, NOW)).toBeUndefined();
    expect(extractResetAt({ reset_at: "" }, NOW)).toBeUndefined();
    expect(extractResetAt({ retry_after: "later" }, NOW)).toBeUndefined();
    expect(extractResetAt({ retry_after: -5 }, NOW)).toBeUndefined();
  });
  it("accepts a clear ISO reset_at", () => {
    expect(extractResetAt({ reset_at: "2026-07-13T11:00:00.000Z" }, NOW)).toBe(
      "2026-07-13T11:00:00.000Z",
    );
  });
  it("accepts a clear numeric retry_after in seconds", () => {
    expect(extractResetAt({ retry_after: 3600 }, NOW)).toBe("2026-07-13T11:00:00.000Z");
  });
});

// The REAL compiled hooks, exactly as shipped: copy dist/hooks/*.js plus the
// CommonJS package.json into the project's .packmind/hooks (what init does),
// then run them with a payload on stdin - hooks are CJS, the repo is ESM, so
// they only run correctly from an installed layout.
const built = fs.existsSync(path.resolve("dist/hooks/stop-failure.js"));

function installHooks(root: string): string {
  const hooksDir = path.join(root, ".packmind", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of fs.readdirSync(path.resolve("dist/hooks")).filter((n) => n.endsWith(".js"))) {
    fs.copyFileSync(path.resolve("dist/hooks", f), path.join(hooksDir, f));
  }
  fs.copyFileSync(path.resolve("src/templates/hooks-package.json"), path.join(hooksDir, "package.json"));
  return hooksDir;
}
function runHook(root: string, script: string, payload: unknown): void {
  execFileSync(process.execPath, [path.join(root, ".packmind", "hooks", script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PACKMIND_ROOT: root },
  });
}
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-hook-"));
  fs.mkdirSync(path.join(root, ".packmind"), { recursive: true });
  if (built) installHooks(root);
  return root;
}

describe.skipIf(!built)("[P1] compiled stop-failure hook", () => {
  it("rate_limit creates a blocked ticket carrying the exact session_id", () => {
    const root = project();
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", session_id: "sess-42", error: "rate_limit" });
    const t = readTicket(root, "sess-42")!;
    expect(t.status).toBe("blocked");
    expect(t.sessionId).toBe("sess-42");
    expect(t.reconcileRequested).toBe(true);
    expect(t.resetAt).toBeUndefined();
  });

  it("a non-rate_limit error creates no ticket", () => {
    const root = project();
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", session_id: "sess-42", error: "server_error" });
    expect(fs.existsSync(ticketFile(root, "sess-42"))).toBe(false);
  });

  it("no session_id -> no ticket, and the ticket holds no payload copy", () => {
    const root = project();
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", error: "rate_limit" });
    expect(fs.existsSync(path.join(root, ".packmind", "state", "resume-tickets"))).toBe(false);

    runHook(root, "stop-failure.js", {
      hook_event_name: "StopFailure",
      session_id: "s",
      error: "rate_limit",
      transcript_path: "/tmp/secret-transcript.jsonl",
      message: "raw api error body",
    });
    const raw = fs.readFileSync(ticketFile(root, "s"), "utf8");
    expect(raw).not.toContain("transcript");
    expect(raw).not.toContain("raw api error body");
  });

  it("a new rate limit puts a launching ticket back to blocked", () => {
    const root = project();
    blockTicket(root, "sess-42", new Date().toISOString());
    expect(tryAcquireLaunch(root, "sess-42", new Date().toISOString())).toBe(true);
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", session_id: "sess-42", error: "rate_limit" });
    expect(readTicket(root, "sess-42")!.status).toBe("blocked");
  });

  it("SessionStart for the same session clears the ticket (resume confirmed)", () => {
    const root = project();
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", session_id: "sess-42", error: "rate_limit" });
    expect(fs.existsSync(ticketFile(root, "sess-42"))).toBe(true);
    runHook(root, "session-start.js", { hook_event_name: "SessionStart", source: "resume", session_id: "sess-42" });
    expect(fs.existsSync(ticketFile(root, "sess-42"))).toBe(false);
  });

  it("SessionStart with a pending ticket reconciles the interrupted turn's changes before clearing", () => {
    const root = project();
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "--allow-empty", "-qm", "init"], { cwd: root });
    // Session starts (this snapshots the git change baseline)...
    runHook(root, "session-start.js", { hook_event_name: "SessionStart", source: "startup", session_id: "sess-r" });
    // ...the turn creates a file out-of-band (Bash/external), then hits the limit.
    fs.writeFileSync(path.join(root, "orphan.ts"), "export const x = 1;\n");
    runHook(root, "stop-failure.js", { hook_event_name: "StopFailure", session_id: "sess-r", error: "rate_limit" });
    // Resume: SessionStart must reconcile THEN drop the ticket.
    runHook(root, "session-start.js", { hook_event_name: "SessionStart", source: "resume", session_id: "sess-r" });
    expect(fs.existsSync(ticketFile(root, "sess-r"))).toBe(false);

    const sessDir = path.join(root, ".packmind", "state", "sessions");
    const rec = JSON.parse(fs.readFileSync(path.join(sessDir, fs.readdirSync(sessDir)[0]), "utf8"));
    const cs = JSON.parse(
      fs.readFileSync(path.join(root, ".packmind", "state", "change-sets", `${rec.id}.json`), "utf8"),
    );
    expect(JSON.stringify(cs.changes)).toContain("orphan.ts");
  });
});
