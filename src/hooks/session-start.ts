import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  requireState,
  brainPath,
  readText,
  appendLine,
  readJson,
  updateJson,
  parseInput,
  readStdin,
  sessionRawKey,
  readSessionFor,
  sessionFile,
  applySessionStart,
  foldSessionIntoLedger,
  emptyLedger,
  hookConfig,
  emitContext,
  type LedgerLike,
  type Session,
} from "./runtime.js";

function foldIntoLedger(s: Session, model: string): void {
  updateJson<LedgerLike>(brainPath("usage.json"), emptyLedger(model), (ledger) => {
    foldSessionIntoLedger(ledger, s, new Date().toISOString());
    return ledger;
  });
}

/** One-time migration of the legacy single global session file into the ledger. */
function migrateLegacy(model: string): void {
  const legacy = brainPath("state", "session.json");
  if (!fs.existsSync(legacy)) return;
  const s = readJson<Session | null>(legacy, null);
  if (s && (Object.keys(s.reads ?? {}).length || (s.writes ?? []).length)) {
    foldIntoLedger(s, s.model ?? model);
  }
  try { fs.rmSync(legacy, { force: true }); } catch { /* ignore */ }
}

async function main(): Promise<void> {
  requireState();
  const cfg = hookConfig();
  const input = parseInput(await readStdin());
  const source = typeof input.source === "string" ? input.source : "startup";
  const model = typeof input.model === "string" ? input.model : undefined;
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined;
  const now = new Date();

  // NOTE: no proactive lock sweep. withLock already reclaims locks older than
  // its TTL on contention; deleting every .lock here could nuke a live peer's.
  migrateLegacy(cfg.model);

  const rawKey = sessionRawKey(input);
  let recordId = "";
  if (rawKey) {
    const existing = readSessionFor(rawKey);
    const { record, fold } = applySessionStart(existing, {
      source,
      model,
      cwd,
      now: now.toISOString(),
      newIncarnationId: crypto.randomUUID(),
      sessionId: typeof input.session_id === "string" ? input.session_id : "",
      transcriptPath: typeof input.transcript_path === "string" ? input.transcript_path : undefined,
    });
    // /clear closes the old incarnation: fold it before overwriting the file.
    if (fold) foldIntoLedger(fold, fold.model ?? cfg.model);
    updateJson<Session | null>(sessionFile(rawKey), null, () => record);
    recordId = record.id;

    appendLine(
      brainPath("journal.md"),
      `\n## ${record.id} - ${now.toISOString()}\n\n| Time | Action | File | Tokens |\n|------|--------|------|--------|\n`,
    );
  }

  const parts: string[] = [];
  const handoff = readText(brainPath("handoff.md")).trim();
  if (handoff && !/no session recorded yet/i.test(handoff)) {
    parts.push("Session handoff (where we left off):\n" + handoff);
  }
  if (recordId) {
    parts.push(`PackMind session: ${recordId} (pass this as session_id to record_evidence when several sessions are active).`);
  }
  parts.push(
    "PackMind is active. Use the `recall` MCP tool to search project memory, and `record_solution`/`remember` to capture fixes and decisions. Check `.packmind/map.md` before reading files.",
  );
  emitContext("SessionStart", parts.join("\n\n"));
}

main();
