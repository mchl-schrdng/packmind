import { spawn } from "node:child_process";
import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { onWindows } from "../util/platform.js";
import {
  listTickets,
  readTicket,
  tryAcquireLaunch,
  releaseLaunch,
  type ResumeTicketV1,
} from "../state/resume.js";

/**
 * `packmind resume` - resume a rate-limited Claude Code session on explicit
 * user request. It never bypasses a limit: it only waits (visibly, in the
 * foreground) for the recorded reset time and then launches
 * `claude --resume <session-id>` once, with inherited stdio, from the
 * validated project root. All side effects are injectable for tests.
 */

export type ResumeDecision =
  | { kind: "launch"; warnUnknownReset: boolean }
  | { kind: "print-reset"; resetAt: string }
  | { kind: "wait"; resetAt: string }
  | { kind: "unknown-wait" };

export function decideResume(ticket: ResumeTicketV1, nowMs: number, wait: boolean): ResumeDecision {
  const resetMs = ticket.resetAt ? Date.parse(ticket.resetAt) : NaN;
  if (Number.isFinite(resetMs)) {
    if (resetMs <= nowMs) return { kind: "launch", warnUnknownReset: false };
    return wait ? { kind: "wait", resetAt: ticket.resetAt! } : { kind: "print-reset", resetAt: ticket.resetAt! };
  }
  // Reset unknown: --wait has nothing to wait for (never launch blind in wait
  // mode); a plain `packmind resume` is an explicit user action, so warn + go.
  return wait ? { kind: "unknown-wait" } : { kind: "launch", warnUnknownReset: true };
}

export function selectTicket(
  tickets: ResumeTicketV1[],
  sessionOpt: string | undefined,
): { ticket: ResumeTicketV1 } | { error: string } {
  if (tickets.length === 0) {
    return { error: "no resume ticket found. Resume tickets are created when a session hits a Claude usage limit." };
  }
  if (sessionOpt) {
    const t = tickets.find((x) => x.sessionId === sessionOpt);
    return t ? { ticket: t } : { error: `no resume ticket for session "${sessionOpt}".` };
  }
  if (tickets.length > 1) {
    const ids = tickets.map((t) => `  ${t.sessionId}${t.resetAt ? ` (reset ${t.resetAt})` : ""}`).join("\n");
    return { error: `several resume tickets exist - pick one with --session <id>:\n${ids}` };
  }
  return { ticket: tickets[0] };
}

export interface ResumeDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  spawnClaude(
    sessionId: string,
    cwd: string,
  ): Promise<{ spawned: true; exitCode: number } | { spawned: false; error: string }>;
  log(m: string): void;
  err(m: string): void;
  /** Register an interrupt (Ctrl-C) handler; returns an unregister fn. */
  onInterrupt(fn: () => void): () => void;
}

function realDeps(): ResumeDeps {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // Argument ARRAY (never a concatenated shell command), inherited terminal,
    // launched exactly once by the caller.
    spawnClaude: (sessionId, cwd) =>
      new Promise((resolve) => {
        const child = spawn(onWindows ? "claude.cmd" : "claude", ["--resume", sessionId], {
          cwd,
          stdio: "inherit",
          shell: false,
        });
        child.once("error", (e) => resolve({ spawned: false, error: e.message }));
        child.once("spawn", () => {
          child.once("exit", (code) => resolve({ spawned: true, exitCode: code ?? 0 }));
        });
      }),
    log: (m) => console.log(m),
    err: (m) => console.error(chalk.red(m)),
    onInterrupt: (fn) => {
      process.on("SIGINT", fn);
      return () => process.off("SIGINT", fn);
    },
  };
}

function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m${String(r).padStart(2, "0")}s` : m ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
}

export async function runResume(
  opts: { session?: string; wait?: boolean } = {},
  depsOverride?: Partial<ResumeDeps>,
): Promise<number> {
  const deps: ResumeDeps = { ...realDeps(), ...depsOverride };
  const { projectRoot } = requireProject();

  const picked = selectTicket(listTickets(projectRoot), opts.session);
  if ("error" in picked) {
    deps.err(`✗ ${picked.error}`);
    return 1;
  }
  const ticket = picked.ticket;
  const decision = decideResume(ticket, deps.now(), Boolean(opts.wait));

  if (decision.kind === "print-reset") {
    deps.log(`Rate limit resets at ${decision.resetAt}. Nothing launched - re-run with --wait to launch automatically at reset.`);
    return 0;
  }
  if (decision.kind === "unknown-wait") {
    deps.err("✗ reset time unknown for this ticket - nothing launched. Retry `packmind resume` after the limit resets.");
    return 1;
  }

  if (decision.kind === "wait") {
    let interrupted = false;
    const off = deps.onInterrupt(() => { interrupted = true; });
    try {
      const target = Date.parse(decision.resetAt);
      deps.log(`Waiting for the rate limit to reset at ${decision.resetAt} (Ctrl-C to abort - nothing will be launched).`);
      while (deps.now() < target) {
        if (interrupted) {
          deps.log("\nAborted - nothing launched, ticket kept.");
          return 130;
        }
        deps.log(`  resuming in ${fmtRemaining(target - deps.now())}`);
        await deps.sleep(Math.min(1000, Math.max(1, target - deps.now())));
      }
      if (interrupted) {
        deps.log("\nAborted - nothing launched, ticket kept.");
        return 130;
      }
    } finally {
      off();
    }
  }

  if (decision.kind === "launch" && decision.warnUnknownReset) {
    deps.log("⚠ reset time unknown - launching anyway because you asked explicitly. If the limit is still active, StopFailure will re-create the ticket.");
  }

  // Duplicate protection: exclusive blocked->launching transition on the ticket.
  if (!tryAcquireLaunch(projectRoot, ticket.sessionId, new Date(deps.now()).toISOString())) {
    deps.err("✗ another `packmind resume` is already launching this session (ticket is not in blocked state).");
    return 1;
  }

  const result = await deps.spawnClaude(ticket.sessionId, projectRoot);
  if (!result.spawned) {
    // Keep the ticket recoverable: back to blocked, user can retry.
    releaseLaunch(projectRoot, ticket.sessionId, new Date(deps.now()).toISOString());
    deps.err(`✗ failed to launch claude: ${result.error}. Ticket kept - fix the PATH and re-run \`packmind resume\`.`);
    return 1;
  }

  // The SessionStart hook removes the ticket when the session demonstrably
  // came back. A ticket still in `launching` after claude exited means the
  // resume was never confirmed (claude errored out, or died before hooks ran):
  // put it back to blocked so `packmind resume` can be retried.
  const leftover = readTicket(projectRoot, ticket.sessionId);
  if (leftover && leftover.status === "launching") {
    releaseLaunch(projectRoot, ticket.sessionId, new Date(deps.now()).toISOString());
    if (result.exitCode === 0) {
      deps.log("Claude exited without confirming the resume - ticket kept so you can retry.");
    }
  }
  if (result.exitCode !== 0) {
    deps.err(`✗ claude exited with code ${result.exitCode}${leftover ? " - ticket kept, re-run `packmind resume`" : ""}.`);
    return 1;
  }
  return 0;
}
