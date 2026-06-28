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

export function buildMap(projectRoot: string, config: Config): { content: string; fileCount: number } {
  const sections = new Map<string, MapEntry[]>();
  for (const { abs, rel } of walkProject(projectRoot, config)) {
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const tokens = estimateTokens(content, rel);
    const key = sectionFor(rel);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push({
      file: path.posix.basename(rel),
      description: describeFile(rel, content),
      tokens,
      cost: inputCost(config.model, tokens),
    });
  }
  let fileCount = 0;
  for (const [, list] of sections) fileCount += list.length;
  return {
    content: serializeMap(sections, { fileCount, updated: new Date().toISOString() }),
    fileCount,
  };
}

export function scanProject(projectRoot: string, config: Config): number {
  const { content, fileCount } = buildMap(projectRoot, config);
  writeText(brain(projectRoot).map, content);
  return fileCount;
}

export function countMapEntries(content: string): number {
  let n = 0;
  for (const [, list] of parseMap(content)) n += list.length;
  return n;
}

export function currentMapEntries(projectRoot: string): number {
  return countMapEntries(readTextOr(brain(projectRoot).map));
}
