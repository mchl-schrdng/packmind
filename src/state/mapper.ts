import * as fs from "node:fs";
import * as path from "node:path";
import { walkProject } from "./walk.js";
import { describeFile } from "./describe.js";
import { parseMap, serializeMap, type MapEntry } from "./formats.js";
import { brain } from "./files.js";
import { writeText, readTextOr } from "../util/fs-atomic.js";
import { estimateTokens } from "../cost/estimator.js";
import { inputCost } from "../cost/pricing.js";
import type { Config } from "./schema.js";

function sectionFor(rel: string): string {
  const dir = path.posix.dirname(rel);
  return dir === "." ? "./" : dir + "/";
}

/** Counts tokens for a file's content. Estimate by default; the exact path
 * (Anthropic count-tokens) is injected so it stays out of the hot path and is
 * testable. */
export type TokenCounter = (content: string, hint: string) => Promise<number>;

const estimateCounter: TokenCounter = async (content, hint) => estimateTokens(content, hint);

function pushEntry(
  sections: Map<string, MapEntry[]>,
  rel: string,
  content: string,
  tokens: number,
  config: Config,
): void {
  const key = sectionFor(rel);
  if (!sections.has(key)) sections.set(key, []);
  sections.get(key)!.push({
    file: path.posix.basename(rel),
    description: describeFile(rel, content),
    tokens,
    cost: inputCost(config.model, tokens, config.cost.prices),
  });
}

function finalize(sections: Map<string, MapEntry[]>): { content: string; fileCount: number } {
  let fileCount = 0;
  for (const [, list] of sections) fileCount += list.length;
  return {
    content: serializeMap(sections, { fileCount, updated: new Date().toISOString() }),
    fileCount,
  };
}

/** Build the map with fast local estimates (synchronous, no network). */
export function buildMap(projectRoot: string, config: Config): { content: string; fileCount: number } {
  const sections = new Map<string, MapEntry[]>();
  for (const { abs, rel } of walkProject(projectRoot, config)) {
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    pushEntry(sections, rel, content, estimateTokens(content, rel), config);
  }
  return finalize(sections);
}

/** Build the map reconciling token counts through `counter` (e.g. exact counts).
 * Falls back per file to the estimate inside the counter on any failure. */
export async function buildMapWith(
  projectRoot: string,
  config: Config,
  counter: TokenCounter = estimateCounter,
): Promise<{ content: string; fileCount: number }> {
  const sections = new Map<string, MapEntry[]>();
  for (const { abs, rel } of walkProject(projectRoot, config)) {
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    pushEntry(sections, rel, content, await counter(content, rel), config);
  }
  return finalize(sections);
}

export function scanProject(projectRoot: string, config: Config): number {
  const { content, fileCount } = buildMap(projectRoot, config);
  writeText(brain(projectRoot).map, content);
  return fileCount;
}

export async function scanProjectWith(
  projectRoot: string,
  config: Config,
  counter: TokenCounter,
): Promise<number> {
  const { content, fileCount } = await buildMapWith(projectRoot, config, counter);
  writeText(brain(projectRoot).map, content);
  return fileCount;
}

/** The set of project-relative file paths recorded in a map.md. */
function mappedFiles(content: string): Set<string> {
  const files = new Set<string>();
  for (const [section, list] of parseMap(content)) {
    const prefix = section === "./" ? "" : section;
    for (const e of list) files.add(prefix + e.file);
  }
  return files;
}

export function countMapEntries(content: string): number {
  let n = 0;
  for (const [, list] of parseMap(content)) n += list.length;
  return n;
}

/** True when map.md no longer reflects the project. Detects added/removed files
 * and any source modified after the map was written (mtime-based), so it stays
 * correct whether the map was built with estimated OR exact token counts. */
export function mapIsStale(projectRoot: string, config: Config): boolean {
  const mapPath = brain(projectRoot).map;
  let mapMtime: number;
  try {
    mapMtime = fs.statSync(mapPath).mtimeMs;
  } catch {
    return true; // no map at all → stale
  }

  const recorded = mappedFiles(readTextOr(mapPath));
  const onDisk = new Set<string>();
  for (const { abs, rel } of walkProject(projectRoot, config)) {
    onDisk.add(rel);
    try {
      if (fs.statSync(abs).mtimeMs > mapMtime) return true; // changed since scan
    } catch {
      /* unreadable — skip */
    }
  }

  if (recorded.size !== onDisk.size) return true;
  for (const f of onDisk) if (!recorded.has(f)) return true;
  return false;
}
