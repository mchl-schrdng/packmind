import * as fs from "node:fs";
import { brain } from "../state/files.js";
import { readLedger, totalCost } from "./ledger.js";
import { inputCost } from "./pricing.js";
import { parseMap } from "../state/formats.js";
import { readTextOr } from "../util/fs-atomic.js";
import { peekQueue } from "../recall/queue.js";
import type { Config } from "../state/schema.js";

export interface Flag {
  level: "good" | "warn";
  title: string;
  detail: string;
}

export interface InsightsReport {
  model: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  reads: number;
  writes: number;
  mapCoverage: number | null; // fraction of reads that hit a map description
  reReadsAvoided: number;
  estTokensSaved: number;
  estCostSaved: number;
  topFiles: Array<{ file: string; tokens: number; cost: number }>;
  flags: Flag[];
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}
function ageDays(p: string): number | null {
  try {
    return (Date.now() - fs.statSync(p).mtimeMs) / 86_400_000;
  } catch {
    return null;
  }
}

/** Derive the "where are tokens going / being saved" picture from existing state. */
export function computeInsights(projectRoot: string, config: Config): InsightsReport {
  const b = brain(projectRoot);
  const ledger = readLedger(projectRoot, config.model);
  const t = ledger.totals;

  // Map: average file size + top files by cost.
  const map = parseMap(readTextOr(b.map));
  const entries: Array<{ file: string; tokens: number; cost: number }> = [];
  let mapTokens = 0;
  for (const [section, list] of map) {
    for (const e of list) {
      const cost = e.cost ?? inputCost(config.model, e.tokens, config.cost.prices);
      entries.push({ file: section + e.file, tokens: e.tokens, cost });
      mapTokens += e.tokens;
    }
  }
  const avgFileTokens = entries.length ? mapTokens / entries.length : 0;
  const topFiles = entries.sort((a, b2) => b2.tokens - a.tokens).slice(0, 5);

  const mapCoverage = t.reads > 0 ? Math.min(1, t.mapHits / t.reads) : null;

  // Conservative savings estimate: map hits avoid ~half a file read on average;
  // each deduped re-read avoids a whole one.
  const estTokensSaved = Math.round(t.mapHits * avgFileTokens * 0.5 + t.dedupedReads * avgFileTokens);
  const estCostSaved = inputCost(config.model, estTokensSaved, config.cost.prices);

  const flags: Flag[] = [];
  if (t.dedupedReads > 0) {
    flags.push({ level: "good", title: "Re-reads avoided", detail: `${t.dedupedReads} redundant reads skipped this project.` });
  }
  if (mapCoverage !== null && mapCoverage < 0.6 && t.reads >= 10) {
    flags.push({ level: "warn", title: "Low map coverage", detail: `Only ${Math.round(mapCoverage * 100)}% of reads hit a map description - run \`packmind scan\`.` });
  }
  const pending = peekQueue(projectRoot).length;
  if (pending > 0) {
    flags.push({ level: "warn", title: "Recall index stale", detail: `${pending} file(s) changed since the last index - run \`packmind index\` or \`packmind maintain\`.` });
  }
  const journalKB = Math.round(sizeOf(b.journal) / 1024);
  if (journalKB > 60) {
    flags.push({ level: "warn", title: "Journal is large", detail: `journal.md is ${journalKB}KB - run \`packmind maintain\` to archive old entries.` });
  }
  const ka = ageDays(b.knowledge);
  if (ka !== null && ka > 21) {
    flags.push({ level: "warn", title: "Knowledge is stale", detail: `knowledge.md hasn't changed in ${Math.round(ka)} days - capture recent decisions with the \`remember\` tool.` });
  }

  return {
    model: ledger.model,
    totalCost: totalCost(ledger),
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    reads: t.reads,
    writes: t.writes,
    mapCoverage,
    reReadsAvoided: t.dedupedReads,
    estTokensSaved,
    estCostSaved,
    topFiles,
    flags,
  };
}
