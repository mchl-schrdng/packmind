import {
  requireState,
  parseInput,
  readStdin,
  extractResetAt,
  blockResumeTicket,
} from "./runtime.js";

/**
 * StopFailure hook. Claude Code fires it when a turn ends on an API error;
 * output and exit code are IGNORED by Claude, so this script only records
 * state: a local resume ticket for the exact session. It never launches,
 * retries, or works around the limit. Registered with matcher "rate_limit",
 * plus a defensive in-payload check for forward compatibility.
 */
async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());

  const sid = typeof input.session_id === "string" && input.session_id.trim() ? input.session_id : null;
  if (!sid) process.exit(0);

  // The registered matcher already filters on rate_limit; if the payload
  // carries an explicit error type anyway, honor it and skip anything else.
  const err =
    typeof input.error === "string" ? input.error
    : typeof input.error_type === "string" ? input.error_type
    : null;
  if (err && err !== "rate_limit") process.exit(0);

  const now = new Date();
  blockResumeTicket(sid, now.toISOString(), extractResetAt(input, now.getTime()));
}

main();
