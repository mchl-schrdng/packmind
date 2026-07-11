import { readJsonOr, updateJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import type { SessionState } from "../state/files.js";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  reads: number;
  writes: number;
  sessions: number;
  dedupedReads: number;
  mapHits: number;
}

export interface UsageLedger {
  version: number;
  model: string;
  createdAt: string;
  totals: UsageTotals;
  sessions: Array<{
    id: string;
    sessionId?: string;
    started: string;
    ended: string;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    reads: number;
    writes: number;
    dedupedReads?: number;
    mapHits?: number;
    model?: string;
    initialSource?: string;
    lastSource?: string;
    status?: string;
    cwd?: string;
  }>;
}

export function emptyLedger(model: string): UsageLedger {
  return {
    version: 2,
    model,
    createdAt: new Date().toISOString(),
    totals: {
      inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0,
      reads: 0, writes: 0, sessions: 0, dedupedReads: 0, mapHits: 0,
    },
    sessions: [],
  };
}

export function readLedger(projectRoot: string, model: string): UsageLedger {
  return readJsonOr<UsageLedger>(brain(projectRoot).usage, emptyLedger(model));
}

export function totalCost(l: UsageLedger): number {
  return l.totals.inputCost + l.totals.outputCost;
}

/**
 * Fold a session's CUMULATIVE counters into the lifetime ledger, upserting by
 * session id. The Stop hook fires once per TURN carrying cumulative session
 * totals, so a plain push+add would count each session quadratically; instead we
 * replace the existing row for this id and adjust totals by the delta. Naturally
 * idempotent (re-folding an identical session nets zero). `totals.sessions`
 * counts distinct ids. Mirrored by foldSessionIntoLedger in hooks/runtime.ts;
 * the two are pinned together by runtime-parity.test.ts.
 */
export function foldSessionIntoLedger(ledger: UsageLedger, s: SessionState, endedAt: string): void {
  ledger.sessions = ledger.sessions ?? [];
  const row = {
    id: s.id,
    sessionId: s.sessionId,
    started: s.started,
    ended: endedAt,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    inputCost: s.inputCost,
    outputCost: s.outputCost,
    reads: Object.keys(s.reads).length,
    writes: s.writes.length,
    dedupedReads: s.dedupedReads,
    mapHits: s.mapHits,
    model: s.model,
    initialSource: s.initialSource,
    lastSource: s.lastSource,
    status: s.status,
    cwd: s.cwd,
  };
  const t = ledger.totals;
  const apply = (r: typeof row, k: number): void => {
    t.inputTokens += k * r.inputTokens;
    t.outputTokens += k * r.outputTokens;
    t.inputCost += k * r.inputCost;
    t.outputCost += k * r.outputCost;
    t.reads += k * r.reads;
    t.writes += k * r.writes;
    t.dedupedReads += k * (r.dedupedReads ?? 0);
    t.mapHits += k * (r.mapHits ?? 0);
  };
  const i = ledger.sessions.findIndex((x) => x.id === s.id);
  if (i === -1) {
    ledger.sessions.push(row);
    t.sessions += 1;
    apply(row, 1);
  } else {
    apply(ledger.sessions[i] as typeof row, -1);
    ledger.sessions[i] = row;
    apply(row, 1);
  }
}

/** Fold a session into the lifetime ledger and persist (upsert by id). */
export function commitSession(projectRoot: string, model: string, s: SessionState): void {
  updateJson<UsageLedger>(brain(projectRoot).usage, emptyLedger(model), (ledger) => {
    foldSessionIntoLedger(ledger, s, new Date().toISOString());
    return ledger;
  });
}
