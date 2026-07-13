import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { extractResetAt } from "../src/hooks/runtime.js";
import { readTicket, ticketFile, blockTicket, tryAcquireLaunch } from "../src/state/resume.js";

const NOW = Date.parse("2026-07-13T10:00:00.000Z");

describe("extractResetAt only trusts the documented error_details string", () => {
  it("returns undefined when nothing usable is present", () => {
    expect(extractResetAt({}, NOW)).toBeUndefined();
    expect(extractResetAt({ error: "rate_limit" }, NOW)).toBeUndefined();
    expect(extractResetAt({ error_details: "Rate limit exceeded." }, NOW)).toBeUndefined();
    expect(extractResetAt({ error_details: "" }, NOW)).toBeUndefined();
    expect(extractResetAt({ error_details: 42 }, NOW)).toBeUndefined();
  });
  it("ignores undocumented structured fields (never invented from guesses)", () => {
    expect(extractResetAt({ reset_at: "2026-07-13T11:00:00.000Z" }, NOW)).toBeUndefined();
    expect(extractResetAt({ retry_after: 3600 }, NOW)).toBeUndefined();
  });
  it('parses the documented "retry after N seconds" phrasing', () => {
    expect(
      extractResetAt({ error_details: "Rate limit exceeded. Please retry after 60 seconds." }, NOW),
    ).toBe("2026-07-13T10:01:00.000Z");
    expect(extractResetAt({ error_details: "retry in 2 minutes" }, NOW)).toBe("2026-07-13T10:02:00.000Z");
    expect(extractResetAt({ error_details: "Retry after 1 hour." }, NOW)).toBe("2026-07-13T11:00:00.000Z");
  });
  it("parses an explicit ISO timestamp inside error_details", () => {
    expect(
      extractResetAt({ error_details: "Your limit resets at 2026-07-13T11:00:00Z." }, NOW),
    ).toBe("2026-07-13T11:00:00.000Z");
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
function runHook(root: string, script: string, payload: unknown): string {
  return execFileSync(process.execPath, [path.join(root, ".packmind", "hooks", script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PACKMIND_ROOT: root },
    encoding: "utf8",
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

  it("SessionStart without a ticket emits context and creates none", () => {
    const root = project();
    const out = runHook(root, "session-start.js", { hook_event_name: "SessionStart", source: "startup", session_id: "sess-r" });
    expect(fs.existsSync(path.join(root, ".packmind", "state", "resume-tickets"))).toBe(false);
    // The hook's stdout is the JSON context envelope Claude Code expects.
    const parsed = JSON.parse(out || "{}");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("recall");
  });
});
