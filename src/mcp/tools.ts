import * as fs from "node:fs";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readJsonOr, writeJson, readTextOr, writeText } from "../util/fs-atomic.js";

export interface ToolContext {
  projectRoot: string;
  config: Config;
}

export function makeContext(projectRoot: string): ToolContext {
  return { projectRoot, config: loadConfig(brain(projectRoot).config) };
}

function keywords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
}

interface RecallDoc {
  source: string;
  text: string;
}

/** Every searchable memory snippet: solutions, knowledge bullets, the handoff. */
function recallCorpus(root: string): RecallDoc[] {
  const b = brain(root);
  const docs: RecallDoc[] = [];
  for (const s of readJsonOr<Solution[]>(b.solutions, [])) {
    const text = [s.error, s.cause && `cause: ${s.cause}`, s.fix && `fix: ${s.fix}`, s.tags?.length && `tags: ${s.tags.join(", ")}`]
      .filter(Boolean)
      .join(" | ");
    docs.push({ source: `solutions/${s.id}`, text });
  }
  let section = "";
  for (const line of readTextOr(b.knowledge).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      section = h[1];
      continue;
    }
    const m = line.match(/^[-*]\s+(.+?)\s*$/);
    if (m) docs.push({ source: `knowledge/${section || "notes"}`, text: m[1] });
  }
  const handoff = readTextOr(b.handoff).trim();
  if (handoff) docs.push({ source: "handoff", text: handoff.slice(0, 1200) });
  return docs;
}

/**
 * Lexical recall over the brain files (knowledge.md, solutions.json,
 * handoff.md). Keyword-overlap ranking - deliberately simple: the corpus is
 * a curated memory, not a codebase, so exact vocabulary carries the signal.
 */
export function toolRecall(ctx: ToolContext, query: string): string {
  const kws = new Set(keywords(query));
  if (kws.size === 0) return "No relevant memory found for that query.";
  const hits = recallCorpus(ctx.projectRoot)
    .map((d) => {
      const hay = keywords(d.text);
      const overlap = new Set(hay.filter((w) => kws.has(w))).size;
      return { d, overlap };
    })
    .filter((x) => x.overlap >= Math.min(2, kws.size))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 6);
  if (hits.length === 0) return "No relevant memory found for that query.";
  return hits
    .map(({ d }, i) => `${i + 1}. [${d.source}]\n${d.text.slice(0, 600)}`)
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
  return `Recorded under "${heading}".`;
}

const normalizeError = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface Solution {
  id: string;
  at: string;
  lastSeen: string;
  occurrences: number;
  error: string;
  cause: string;
  fix: string;
  file: string;
  tags: string[];
}

export function toolRecordSolution(
  ctx: ToolContext,
  args: { error: string; cause?: string; fix?: string; tags?: string[]; file?: string },
): string {
  if (!args.error.trim()) return "Nothing to record (empty error).";
  const path = brain(ctx.projectRoot).solutions;
  const list = readJsonOr<Solution[]>(path, []);
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
    return `Updated existing solution ${existing.id} - now seen ${existing.occurrences} times.`;
  }

  const entry: Solution = {
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
  return `Recorded solution ${entry.id}.`;
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
