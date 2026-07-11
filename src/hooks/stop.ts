import {
  requireState,
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

  const reads = Object.keys(session.reads).length;
  if (reads === 0 && session.writes.length === 0) process.exit(0);

  const cfg = hookConfig();

  // Commit the session into the lifetime usage ledger. Stop fires once per TURN
  // with cumulative session totals, so the fold upserts by session id (replacing
  // this session's row and adjusting totals by the delta) rather than pushing a
  // new row each turn - otherwise every figure inflates quadratically. The
  // read-modify-write is locked so a concurrent writer can't lose the update.
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

  // Regenerate the session handoff doc for cheap resume next time.
  if (session.writes.length > 0) {
    const recent = session.writes.slice(-12).map((w) => `- \`${w.file}\` (${w.action})`);
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

  // Latch reminders so each fires at most once per session - otherwise the
  // still-true condition re-emits every turn and the Stop emission re-invokes
  // the agent in an infinite loop. Practice-pack session checks (e.g. "src/**
  // changed but no test written") come from the pre-resolved effective guard set.
  const effective = readJson<{ checks?: SessionCheck[] }>(brainPath("guard.effective.json"), {});
  const reminders = [
    ...computeStopReminders(session),
    ...computePracticeReminders(session, effective.checks ?? []),
  ];
  // Persist the reminder latches (mutated in-memory above) onto this session's
  // own file, inside a lock, so a concurrent hook write isn't clobbered.
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
