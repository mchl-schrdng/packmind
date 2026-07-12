import * as fs from "node:fs";
import { brain, type SessionState } from "../state/files.js";
import { activeSessions } from "../state/session.js";
import { resolveChangeSession, getChangeSet, formatChangeSet } from "../change/service.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readJsonOr, writeJson, readTextOr, writeText, updateJson } from "../util/fs-atomic.js";
import { parseMap } from "../state/formats.js";
import { harvestDebt } from "../state/debt.js";
import { gitDiff, reviewPayload } from "../state/review.js";
import { store as storeBlob, retrieve as retrieveBlob } from "../compress/store.js";
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

/**
 * Record evidence that a practice check has been satisfied (e.g. tests were run,
 * a workflow was reviewed). The entry is appended to the correct live session so
 * the matching session-level check stops nudging at Stop.
 *
 * Sessions are per-session_id now, and the MCP server has no ambient session, so
 * routing resolves: an explicit `session_id` -> that session; else the single
 * active session; else (several active) an ambiguity error asking for an id. The
 * write uses the same file lock the hooks use, so a concurrent hook write can't
 * lose it.
 */
export function toolRecordEvidence(
  ctx: ToolContext,
  args: { check: string; detail?: string; session_id?: string },
): string {
  const check = String(args.check ?? "").trim();
  if (!check) return "Nothing to record (empty check).";

  const active = activeSessions(ctx.projectRoot);
  let target: { file: string; record: SessionState } | undefined;
  if (args.session_id) {
    const id = String(args.session_id);
    target = active.find((s) => s.record.id === id || s.record.sessionId === id);
    if (!target) return `No active session matching "${id}" (nothing recorded).`;
  } else if (active.length === 1) {
    target = active[0];
  } else if (active.length === 0) {
    return "No active session to attach evidence to (recorded nothing).";
  } else {
    return `Multiple active sessions: ${active.map((s) => s.record.id).join(", ")}. Pass session_id to record_evidence to choose one.`;
  }

  updateJson<SessionState | null>(target.file, null, (s) => {
    if (!s) return s;
    s.evidence = [
      ...(s.evidence ?? []),
      { check, detail: args.detail ? String(args.detail) : undefined, at: new Date().toISOString() },
    ];
    return s;
  });
  return `Evidence recorded for "${check}" (session ${target.record.id}). The matching practice check will stay quiet this session.`;
}

export async function toolRecall(ctx: ToolContext, query: string): Promise<string> {
  if (!ctx.config.recall.enabled) return "Recall is disabled in config.";
  const hits = await recallSearch(ctx.projectRoot, ctx.config, ctx.embedder, query);
  if (hits.length === 0)
    return indexSize(ctx.projectRoot, ctx.config) === 0
      ? "Recall index isn't built yet - run `packmind index` to enable semantic search."
      : "No relevant memory found for that query.";
  return hits
    .map((h, i) => `${i + 1}. [${h.kind} · ${h.source} · score ${h.score.toFixed(2)}]\n${h.text.slice(0, 600)}`)
    .join("\n\n");
}

export function toolRemember(ctx: ToolContext, note: string, kind = "Notes"): string {
  if (!note.trim()) return "Nothing to remember (empty note).";
  const heading = ["Preferences", "Decisions", "Never Do", "Notes", "Debt"].includes(kind) ? kind : "Notes";
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
  if (!args.error.trim()) return "Nothing to record (empty error).";
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
    return `Updated existing solution ${existing.id} - now seen ${existing.occurrences} times.`;
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
      .map((e) => `  ${section}${e.file} - ${e.description || "?"} (~${e.tokens} tok)`);
    if (rows.length) out.push(`${section}\n${rows.join("\n")}`);
  }
  return out.length ? out.join("\n") : "Map is empty - run `packmind scan`.";
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
    for (const f of r.topFiles) lines.push(`  ${f.file} - ~${f.tokens} tok ($${f.cost.toFixed(4)})`);
  }
  for (const f of r.flags) lines.push(`[${f.level}] ${f.title}: ${f.detail}`);
  if (r.compress.blobs) {
    const kb = Math.round(r.compress.bytes / 1024);
    lines.push(`Compression store: ${r.compress.blobs} blob(s), ~${kb} KB shelved (retrieve to restore).`);
  }
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

export function toolDebt(ctx: ToolContext): string {
  const items = harvestDebt(ctx.projectRoot, ctx.config);
  if (!items.length) return "No `packmind:` debt markers found.";
  return [
    `${items.length} deferred shortcut${items.length === 1 ? "" : "s"}:`,
    ...items.map((i) => `  ${i.file}:${i.line}  ${i.note}`),
  ].join("\n");
}

export function toolReview(ctx: ToolContext, base?: string): string {
  return reviewPayload(gitDiff(ctx.projectRoot, base));
}

export function toolCompress(ctx: ToolContext, content: string, kind?: string): string {
  if (!content) return "Nothing to compress (empty content).";
  const { hash, bytes, preview } = storeBlob(ctx.projectRoot, content, kind || "text");
  return `Stored ${bytes} bytes as ${hash}. Retrieve the full original with retrieve("${hash}").\n\n${preview}`;
}

export function toolRetrieve(ctx: ToolContext, hash: string): string {
  return retrieveBlob(ctx.projectRoot, hash) ?? `No stored content for "${hash}" (it may have been pruned).`;
}

/**
 * Read-only view of the current session's net change set (files different from
 * the session's start, from any source). Routes by session like record_evidence.
 */
export function toolChanges(ctx: ToolContext, args: { session_id?: string }): string {
  const r = resolveChangeSession(ctx.projectRoot, args.session_id);
  if ("error" in r) return r.error;
  if ("none" in r) return "No active PackMind session.";
  return formatChangeSet(getChangeSet(ctx.projectRoot, r.ok.incarnationId));
}

/** True if the project has been initialized. */
export function isInitialized(projectRoot: string): boolean {
  return fs.existsSync(brain(projectRoot).config);
}
