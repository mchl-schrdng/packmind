import * as fs from "node:fs";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readJsonOr, writeJson, appendLine, readTextOr, writeText } from "../util/fs-atomic.js";
import { parseMap } from "../state/formats.js";
import { readLedger, totalCost } from "../cost/ledger.js";
import { recall as recallSearch } from "../recall/indexer.js";
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
  if (hits.length === 0) return "No relevant memory found. Index may be empty — run `packmind index`.";
  return hits
    .map((h, i) => `${i + 1}. [${h.kind} · ${h.source} · score ${h.score.toFixed(2)}]\n${h.text.slice(0, 600)}`)
    .join("\n\n");
}

export function toolRemember(ctx: ToolContext, note: string, kind = "Notes"): string {
  const heading = ["Preferences", "Decisions", "Never Do", "Notes"].includes(kind) ? kind : "Notes";
  const file = brain(ctx.projectRoot).knowledge;
  const existing = readTextOr(file);
  // Append under the heading if present; otherwise create it.
  if (new RegExp(`^##\\s+${heading}\\b`, "m").test(existing)) {
    appendLine(file, `\n<!-- ${heading} -->\n- ${new Date().toISOString().slice(0, 10)}: ${note}\n`);
  } else {
    appendLine(file, `\n## ${heading}\n\n- ${new Date().toISOString().slice(0, 10)}: ${note}\n`);
  }
  enqueue(ctx.projectRoot, ".packmind/knowledge.md");
  return `Recorded under "${heading}".`;
}

export function toolRecordSolution(
  ctx: ToolContext,
  args: { error: string; cause?: string; fix?: string; tags?: string[] },
): string {
  const file = brain(ctx.projectRoot).solutions;
  const list = readJsonOr<any[]>(file, []);
  const entry = {
    id: `sol-${Date.now()}`,
    at: new Date().toISOString(),
    error: args.error,
    cause: args.cause ?? "",
    fix: args.fix ?? "",
    tags: args.tags ?? [],
  };
  list.push(entry);
  writeJson(file, list);
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
