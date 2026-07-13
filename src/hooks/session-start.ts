import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  requireState,
  projectRoot,
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
  isGitRepo,
  gitWatchPaths,
  createBaselineGit,
  createBaselineManifest,
  writeBaseline,
  readBaseline,
  emptyChangeSet,
  updateChangeSet,
  emitSessionStart,
  clearResumeTicket,
  resumeTicketFile,
  reconcileAndSync,
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

    // New incarnation (fresh start, or /clear): snapshot a change baseline so the
    // reconciler has something to diff against. Git only in-hook; non-git manifest
    // baselines are created lazily by the CLI/MCP. Fail open on any error.
    const isNewIncarnation = !existing || existing.id !== record.id;
    if (isNewIncarnation) {
      try {
        const r = projectRoot();
        const meta = { incarnationId: record.id, sessionId: record.sessionId, cwd };
        // Git projects reconcile in-hook; non-git get a bounded manifest baseline
        // captured NOW (before changes) so the CLI/maintain reconcile is correct.
        const baseline = isGitRepo(r)
          ? createBaselineGit(r, meta, cfg.extraSecretGlobs, cfg.excludeDirs)
          : createBaselineManifest(r, meta, cfg.extraSecretGlobs, cfg.excludeDirs, cfg.maxFiles);
        writeBaseline(baseline);
        updateChangeSet(
          record.id,
          emptyChangeSet({
            incarnationId: record.id,
            sessionId: record.sessionId,
            root: projectRoot(),
            cwd,
            baselineCreatedAt: baseline.createdAt,
          }),
          () => {},
        );
      } catch {
        /* baseline is best-effort; the CLI can rebuild it */
      }
    }

    // A resume ticket for this session means a turn was cut off by a rate
    // limit: reconcile the interrupted turn's changes NOW (Bash/external
    // edits included - the ticket's reconcileRequested contract), then drop
    // the ticket. StopFailure re-creates it if the limit hits again.
    if (record.sessionId && fs.existsSync(resumeTicketFile(record.sessionId))) {
      try {
        reconcileAndSync(projectRoot(), record, cfg);
      } catch {
        /* reconcile retries at the next Stop/maintain; never block startup */
      }
      try {
        clearResumeTicket(record.sessionId);
      } catch {
        /* ticket cleanup is best-effort */
      }
    }

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

  // Bounded watchPaths for FileChanged: absolute paths of the baseline's known
  // eligible files (cheap - the baseline is already computed). Latency-only.
  let watchPaths: string[] = [];
  if (recordId) {
    try {
      const r2 = projectRoot();
      // Git: tracked, non-ignored, eligible files (the baseline only fingerprints
      // dirty paths, so a clean repo would otherwise watch nothing). Non-git: the
      // manifest baseline's eligible files.
      const rels = isGitRepo(r2)
        ? gitWatchPaths(r2, cfg.extraSecretGlobs, cfg.excludeDirs, 1000)
        : Object.keys(readBaseline(recordId)?.hashes ?? {}).slice(0, 1000);
      watchPaths = rels.map((rel) => path.join(r2, rel));
    } catch {
      /* watchPaths is optional */
    }
  }
  emitSessionStart(parts.join("\n\n"), watchPaths);
}

main();
