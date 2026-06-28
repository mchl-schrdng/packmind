import { readJsonOr, writeJson } from "../util/fs-atomic.js";
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
    started: string;
    ended: string;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    reads: number;
    writes: number;
  }>;
}

export function emptyLedger(model: string): UsageLedger {
  return {
    version: 1,
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

/** Fold a finished session into the lifetime ledger. */
export function commitSession(projectRoot: string, model: string, s: SessionState): void {
  const ledger = readLedger(projectRoot, model);
  const reads = Object.keys(s.reads).length;
  ledger.sessions.push({
    id: s.id,
    started: s.started,
    ended: new Date().toISOString(),
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    inputCost: s.inputCost,
    outputCost: s.outputCost,
    reads,
    writes: s.writes.length,
  });
  const t = ledger.totals;
  t.inputTokens += s.inputTokens;
  t.outputTokens += s.outputTokens;
  t.inputCost += s.inputCost;
  t.outputCost += s.outputCost;
  t.reads += reads;
  t.writes += s.writes.length;
  t.sessions += 1;
  t.dedupedReads += s.dedupedReads;
  t.mapHits += s.mapHits;
  writeJson(brain(projectRoot).usage, ledger);
}
