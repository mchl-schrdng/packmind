import * as fs from "node:fs";
import {
  requireState,
  brainPath,
  readText,
  readJson,
  parseInput,
  readStdin,
  emitContext,
  clearResumeTicket,
  resumeTicketFile,
} from "./runtime.js";

/**
 * SessionStart hook: inject the standing context (handoff note, memory usage
 * hints) and confirm a resumed rate-limited session by dropping its ticket.
 */
async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());
  const sid = typeof input.session_id === "string" && input.session_id.trim() ? input.session_id : null;

  // A resume ticket for this session means a turn was cut off by a rate limit
  // and `packmind resume` relaunched it: the session is back, drop the ticket.
  // StopFailure re-creates it if the limit hits again.
  if (sid && fs.existsSync(resumeTicketFile(sid))) {
    try {
      clearResumeTicket(sid);
    } catch {
      /* ticket cleanup is best-effort; never block startup */
    }
  }

  const parts: string[] = [];
  const handoff = readText(brainPath("handoff.md")).trim();
  if (handoff && !/no session recorded yet/i.test(handoff)) {
    parts.push("Session handoff (where we left off):\n" + handoff);
  }
  const solutions = readJson<unknown[]>(brainPath("solutions.json"), []);
  const solutionCount = Array.isArray(solutions) ? solutions.length : 0;
  parts.push(
    "PackMind is active. Use the `recall` MCP tool to search project memory" +
      (solutionCount ? ` (${solutionCount} recorded fix${solutionCount === 1 ? "" : "es"})` : "") +
      ", `remember` to capture decisions, `record_solution` to capture fixes, and `handoff` to leave a note for the next session.",
  );
  emitContext("SessionStart", parts.join("\n\n"));
}

main();
