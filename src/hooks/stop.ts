import {
  requireState,
  brainPath,
  readJson,
  updateJson,
  writeText,
  appendLine,
  readSession,
  writeSession,
  computeStopReminders,
  computePracticeReminders,
  foldSessionIntoLedger,
  hookConfig,
  emitContext,
  type LedgerLike,
  type SessionCheck,
} from "./runtime.js";

async function main(): Promise<void> {
  requireState();
  const session = readSession();
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
  const emptyLedger = (): LedgerLike => ({
    version: 1,
    model: cfg.model,
    createdAt: endedAt,
    totals: { inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, reads: 0, writes: 0, sessions: 0, dedupedReads: 0, mapHits: 0 },
    sessions: [],
  });
  updateJson<LedgerLike>(brainPath("usage.json"), emptyLedger(), (ledger) => {
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
  if (reminders.length) writeSession(session);
  emitContext("Stop", reminders.join(" "));
}

main().catch(() => process.exit(0));
