import * as path from "node:path";
import { brain } from "./files.js";
import { updateText } from "../util/fs-atomic.js";
import { parseMap, serializeMap, type MapEntry } from "./formats.js";
import { describeFile } from "./describe.js";
import { estimateTokens } from "../cost/estimator.js";
import { inputCost } from "../cost/pricing.js";
import type { Config } from "./schema.js";

/** map.md section header for a project-relative path (`./` for the root). */
function sectionOf(rel: string): string {
  const dir = path.posix.dirname(rel);
  return dir === "." ? "./" : dir + "/";
}

function recount(map: Map<string, MapEntry[]>): number {
  let n = 0;
  for (const [, list] of map) n += list.length;
  return n;
}

/**
 * Add or update a single file's map.md entry, under one lock so a concurrent
 * map write can't be lost. Reuses the canonical describe/estimate/pricing so
 * hook-driven updates match `packmind scan`.
 */
export function upsertMapEntry(root: string, rel: string, content: string, config: Config): void {
  updateText(brain(root).map, (text) => {
    const map = parseMap(text);
    const section = sectionOf(rel);
    const file = path.posix.basename(rel);
    const tokens = estimateTokens(content, rel);
    const entry: MapEntry = {
      file,
      description: describeFile(rel, content),
      tokens,
      cost: inputCost(config.model, tokens, config.cost.prices),
    };
    if (!map.has(section)) map.set(section, []);
    const list = map.get(section)!;
    const idx = list.findIndex((e) => e.file === file);
    if (idx >= 0) {
      // Keep a previously-computed description if this pass couldn't derive one.
      if (!entry.description && list[idx].description) entry.description = list[idx].description;
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    return serializeMap(map, { fileCount: recount(map), updated: new Date().toISOString() });
  });
}

/** Remove a file's map.md entry (and its section if now empty), under one lock. */
export function removeMapEntry(root: string, rel: string): void {
  updateText(brain(root).map, (text) => {
    const map = parseMap(text);
    const section = sectionOf(rel);
    const file = path.posix.basename(rel);
    const list = map.get(section);
    if (list) {
      const idx = list.findIndex((e) => e.file === file);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) map.delete(section);
    }
    return serializeMap(map, { fileCount: recount(map), updated: new Date().toISOString() });
  });
}
