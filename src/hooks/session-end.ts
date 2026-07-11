import * as fs from "node:fs";
import {
  requireState,
  brainPath,
  writeText,
  updateJson,
  parseInput,
  readStdin,
  sessionRawKey,
  readSessionFor,
  sessionFile,
  updateSession,
  classifySessionEnd,
  foldSessionIntoLedger,
  emptyLedger,
  hookConfig,
  type LedgerLike,
} from "./runtime.js";

async function main(): Promise<void> {
  requireState();
  const cfg = hookConfig();
  const input = parseInput(await readStdin());
  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);
  const session = readSessionFor(rawKey);
  if (!session) process.exit(0);
  const reason = typeof input.reason === "string" ? input.reason : "other";

  // Fold FIRST (idempotent). The live file is only removed AFTER a successful
  // fold: if the ledger write throws, main().catch swallows it and the session
  // survives for a later fold. Never lose a session to a failed fold.
  updateJson<LedgerLike>(brainPath("usage.json"), emptyLedger(session.model ?? cfg.model), (ledger) => {
    foldSessionIntoLedger(ledger, session, new Date().toISOString());
    return ledger;
  });

  if (classifySessionEnd(reason) === "remove") {
    // Terminal end (not /clear): refresh the handoff before removing the file.
    if (reason !== "clear" && (session.writes ?? []).length > 0) {
      const recent = session.writes.slice(-12).map((w) => `- \`${w.file}\` (${w.action})`);
      writeText(
        brainPath("handoff.md"),
        [
          "# Session Handoff", "",
          `_Updated ${new Date().toISOString()} · ${session.id}_`, "",
          "## Recently changed", ...recent, "",
          "## Next steps", "- (Capture what's left to do here, or via the `remember` MCP tool.)", "",
        ].join("\n"),
      );
    }
    try { fs.rmSync(sessionFile(rawKey), { force: true }); } catch { /* ignore */ }
  } else {
    // resume / unknown reason: suspend and keep the file (it may resume).
    updateSession(rawKey, (s) => {
      s.status = "suspended";
      s.lastEventAt = new Date().toISOString();
    });
  }
}

main().catch(() => process.exit(0));
