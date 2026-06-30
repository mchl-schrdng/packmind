import * as fs from "node:fs";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readJsonOr, writeJson, appendLine, readTextOr, writeText } from "../util/fs-atomic.js";
import { parseMap } from "../state/formats.js";
import { readLedger, totalCost } from "../cost/ledger.js";
import { recall as recallSearch, indexSize } from "../recall/indexer.js";
import { computeInsights } from "../cost/insights.js";
import { LocalEmbedder, type Embedder } from "../recall/embedder.js";
import { enqueue } from "../recall/queue.js";

export interface ToolContext {
  projectRoot: string;
  config: Config;
  embedder: Embedder;
}

export function makeContext(projectRoot: string): ToolContext {
  const config = loadConfig(brain(projectRoot).config);
  return { projectRoot, config, embedder: new LocalEmbedder(config.recall.embedModel) };
}

export async function toolRecall(ctx: ToolContext, query: string): Promise<string> {
  if (!ctx.config.recall.enabled) return "Recall is disabled in config.";
  const hits = await recallSearch(ctx.projectRoot, ctx.config, ctx.embedder, query);
  if (hits.length === 0)
    return indexSize(ctx.projectRoot, ctx.config) === 0
      ? "Recall index isn't built yet — run `packmind index` to enable semantic search."
      : "No relevant memory found for that query.";
  return hits
    .map((h, i) => `${i + 1}. [${h.kind} · ${h.source} · score ${h.score.toFixed(2)}]\n${h.text.slice(0, 600)}`)
    .join("\n\n");
}

export function toolRemember(ctx: ToolContext, note: string, kind = "Notes"): string {
  const heading = ["Preferences", "Decisions", "Never Do", "Notes"].includes(kind) ? kind : "Notes";
  const file = brain(ctx.projectRoot).knowledge;
  const entry = `- ${new Date().toISOString().slice(0, 10)}: ${note}`;
  const lines = readTextOr(file).split(/\r?\n/);

  // Insert directly UNDER the matching `## Heading` (before the next `##`), so
  // the entry is actually parsed back (e.g. parseNeverDo reads only that
  // section). Appending at EOF would land it under the wrong heading.
  const headIdx = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\b`, "i").test(l));
  if (headIdx === -1) {
    const text = readTextOr(file).replace(/\s*$/, "");
    writeText(file, `${text}\n\n## ${heading}\n\n${entry}\n`);
  } else {
    let insertAt = headIdx + 1;
    if (lines[insertAt] === "") insertAt++; // keep one blank line after the heading
    lines.splice(insertAt, 0, entry);
    writeText(file, lines.join("\n"));
  }
  enqueue(ctx.projectRoot, ".packmind/knowledge.md");
  return `Recorded under "${heading}".`;
}

const normalizeError = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function toolRecordSolution(
  ctx: ToolContext,
  args: { error: string; cause?: string; fix?: string; tags?: string[]; file?: string },
): string {
  const path = brain(ctx.projectRoot).solutions;
  const list = readJsonOr<any[]>(path, []);
  const now = new Date().toISOString();

  // De-dupe: if we've seen this error before, bump its occurrence count instead
  // of appending a near-duplicate (keeps the bug memory high-signal).
  const key = normalizeError(args.error);
  const existing = list.find((s) => normalizeError(s.error ?? "") === key);
  if (existing) {
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    existing.lastSeen = now;
    if (args.fix && !existing.fix) existing.fix = args.fix;
    if (args.file && !existing.file) existing.file = args.file;
    for (const tag of args.tags ?? []) if (!existing.tags?.includes(tag)) (existing.tags ??= []).push(tag);
    writeJson(path, list);
    enqueue(ctx.projectRoot, ".packmind/solutions.json");
    return `Updated existing solution ${existing.id} — now seen ${existing.occurrences} times.`;
  }

  const entry = {
    id: `sol-${Date.now()}`,
    at: now,
    lastSeen: now,
    occurrences: 1,
    error: args.error,
    cause: args.cause ?? "",
    fix: args.fix ?? "",
    file: args.file ?? "",
    tags: args.tags ?? [],
  };
  list.push(entry);
  writeJson(path, list);
  enqueue(ctx.projectRoot, ".packmind/solutions.json");
  return `Recorded solution ${entry.id}.`;
}

export function toolProjectMap(ctx: ToolContext, filter?: string): string {
  const map = parseMap(readTextOr(brain(ctx.projectRoot).map));
  const out: string[] = [];
  for (const [section, entries] of map) {
    const rows = entries
      .filter((e) => !filter || (section + e.file).toLowerCase().includes(filter.toLowerCase()))
      .map((e) => `  ${section}${e.file} — ${e.description || "?"} (~${e.tokens} tok)`);
    if (rows.length) out.push(`${section}\n${rows.join("\n")}`);
  }
  return out.length ? out.join("\n") : "Map is empty — run `packmind scan`.";
}

export function toolInsights(ctx: ToolContext): string {
  const r = computeInsights(ctx.projectRoot, ctx.config);
  const lines = [
    `Cost so far: $${r.totalCost.toFixed(4)} (${r.inputTokens} in / ${r.outputTokens} out)`,
    `Estimated saved: $${r.estCostSaved.toFixed(4)} (~${r.estTokensSaved} tokens; ${r.reReadsAvoided} re-reads avoided)`,
    `Map coverage: ${r.mapCoverage === null ? "n/a" : Math.round(r.mapCoverage * 100) + "%"}`,
  ];
  if (r.topFiles.length) {
    lines.push("Heaviest files:");
    for (const f of r.topFiles) lines.push(`  ${f.file} — ~${f.tokens} tok ($${f.cost.toFixed(4)})`);
  }
  for (const f of r.flags) lines.push(`[${f.level}] ${f.title}: ${f.detail}`);
  return lines.join("\n");
}

export function toolUsageReport(ctx: ToolContext): string {
  const ledger = readLedger(ctx.projectRoot, ctx.config.model);
  const t = ledger.totals;
  return [
    `Model: ${ledger.model}`,
    `Sessions: ${t.sessions}`,
    `Reads: ${t.reads} (deduped ${t.dedupedReads}, map hits ${t.mapHits})`,
    `Writes: ${t.writes}`,
    `Tokens: ${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out`,
    `Cost: $${totalCost(ledger).toFixed(4)} ($${t.inputCost.toFixed(4)} in / $${t.outputCost.toFixed(4)} out)`,
  ].join("\n");
}

export function toolHandoff(ctx: ToolContext, action: "get" | "set", content?: string): string {
  const file = brain(ctx.projectRoot).handoff;
  if (action === "set") {
    writeText(file, `# Session Handoff\n\n_Updated ${new Date().toISOString()}_\n\n${content ?? ""}\n`);
    return "Handoff updated.";
  }
  const text = readTextOr(file).trim();
  return text || "No handoff recorded yet.";
}

/** True if the project has been initialized. */
export function isInitialized(projectRoot: string): boolean {
  return fs.existsSync(brain(projectRoot).config);
}
