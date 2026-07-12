import {
  requireState,
  projectRoot,
  brainPath,
  readJson,
  updateJson,
  writeText,
  appendLine,
  parseInput,
  readStdin,
  sessionRawKey,
  readSessionFor,
  updateSession,
  reconcileAndSync,
  changedPaths,
  computeStopReminders,
  computePracticeReminders,
  foldSessionIntoLedger,
  emptyLedger,
  hookConfig,
  emitContext,
  type LedgerLike,
  type SessionCheck,
} from "./runtime.js";

async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());
  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);
  const session = readSessionFor(rawKey);
  if (!session) process.exit(0);

  const cfg = hookConfig();
  const root = projectRoot();

  // Reconcile FIRST so the change set reflects Bash/external/parallel changes,
  // not just direct Write/Edit calls. Git projects reconcile in-hook; a non-git
  // or missing baseline returns the current set unchanged (deferred to the CLI).
  const changeSet = reconcileAndSync(root, session, cfg);
  const netPaths = changedPaths(changeSet);

  const reads = Object.keys(session.reads).length;
  if (reads === 0 && session.writes.length === 0 && netPaths.length === 0) process.exit(0);

  // Commit the session into the lifetime usage ledger (locked, upsert by id).
  const endedAt = new Date().toISOString();
  updateJson<LedgerLike>(brainPath("usage.json"), emptyLedger(cfg.model), (ledger) => {
    foldSessionIntoLedger(ledger, session, endedAt);
    return ledger;
  });

  const turnCost = session.inputCost + session.outputCost;
  appendLine(
    brainPath("journal.md"),
    `\n> ${session.id}: ${reads} reads, ${session.writes.length} writes, ~$${turnCost.toFixed(4)} this turn.\n`,
  );

  // Handoff from the canonical net change set (falls back to direct writes).
  const recent =
    netPaths.length > 0
      ? netPaths.slice(-12).map((p) => `- \`${p}\``)
      : session.writes.slice(-12).map((w) => `- \`${w.file}\` (${w.action})`);
  if (recent.length > 0) {
    writeText(
      brainPath("handoff.md"),
      [
        "# Session Handoff",
        "",
        `_Updated ${new Date().toISOString()} · ${session.id}_`,
        "",
        "## Recently changed",
        ...recent,
        "",
        "## Next steps",
        "- (Capture what's left to do here, or via the `remember` MCP tool.)",
        "",
      ].join("\n"),
    );
  }

  // Latch reminders so each fires at most once per session (otherwise the
  // still-true condition re-emits every turn and the Stop emission re-invokes the
  // agent in a loop). Practice checks now see the full net change set.
  const effective = readJson<{ checks?: SessionCheck[] }>(brainPath("guard.effective.json"), {});
  const reminders = [
    ...computeStopReminders(session),
    ...computePracticeReminders(session, effective.checks ?? [], netPaths.length ? netPaths : undefined),
  ];
  if (reminders.length) {
    updateSession(rawKey, (s) => {
      s.notifiedWrites = session.notifiedWrites;
      s.notifiedEdits = session.notifiedEdits;
      s.notifiedLean = session.notifiedLean;
      s.notifiedCompress = session.notifiedCompress;
      s.notifiedPractice = session.notifiedPractice;
    });
  }
  emitContext("Stop", reminders.join(" "));
}

main().catch(() => process.exit(0));
