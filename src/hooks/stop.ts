import {
  requireState,
  brainPath,
  readJson,
  writeJson,
  writeText,
  appendLine,
  readSession,
  writeSession,
  computeStopReminders,
  hookConfig,
  emitContext,
} from "./runtime.js";

async function main(): Promise<void> {
  requireState();
  const session = readSession();
  if (!session) process.exit(0);

  const reads = Object.keys(session.reads).length;
  if (reads === 0 && session.writes.length === 0) process.exit(0);

  const cfg = hookConfig();

  // Commit the session into the lifetime usage ledger (inline; hooks are dep-free).
  const usagePath = brainPath("usage.json");
  const ledger = readJson<any>(usagePath, null);
  if (ledger?.totals) {
    ledger.sessions = ledger.sessions ?? [];
    ledger.sessions.push({
      id: session.id,
      started: session.started,
      ended: new Date().toISOString(),
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      inputCost: session.inputCost,
      outputCost: session.outputCost,
      reads,
      writes: session.writes.length,
      dedupedReads: session.dedupedReads,
      mapHits: session.mapHits,
    });
    const t = ledger.totals;
    t.inputTokens += session.inputTokens;
    t.outputTokens += session.outputTokens;
    t.inputCost += session.inputCost;
    t.outputCost += session.outputCost;
    t.reads += reads;
    t.writes += session.writes.length;
    t.sessions += 1;
    t.dedupedReads += session.dedupedReads;
    t.mapHits += session.mapHits;
    writeJson(usagePath, ledger);
  }

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
  // the agent in an infinite loop.
  const reminders = computeStopReminders(session);
  if (reminders.length) writeSession(session);
  emitContext("Stop", reminders.join(" "));
}

main().catch(() => process.exit(0));
