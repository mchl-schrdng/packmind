import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import { DEFAULT_POLICY, type Rule } from "./policy.js";
import type { Config } from "../state/schema.js";

/**
 * Practice packs: composable, versioned guard profiles shipped as data. Each
 * pack contributes zero or more per-write `rules` (evaluated in the pre-write
 * hook, same shape as policy.json) and zero or more session-level `checks`
 * (evaluated at Stop, e.g. "src/** changed but no test written this session").
 *
 * Active packs are named in `config.guard.practices`. `writeEffective` resolves
 * default rules + packs + the user's local policy.json into a single derived
 * file, `.packmind/guard.effective.json`, which the zero-dependency hooks read
 * directly - so the composition logic lives here (canonical), never in a hook.
 */

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/guard at runtime
export const PACKS_DIR = path.join(here, "..", "..", "src", "templates", "packs");

export interface SessionCheck {
  id: string;
  message: string;
  changedGlobs: string[];
  missingChangedGlobs?: string[];
  needsEvidence?: string;
}

export interface Pack {
  name: string;
  version: number;
  rules?: Rule[];
  checks?: SessionCheck[];
}

export interface EffectiveGuard {
  rules: Rule[];
  checks: SessionCheck[];
}

/** Names of the bundled packs (filenames under PACKS_DIR, without extension). */
export function listPacks(packsDir = PACKS_DIR): string[] {
  try {
    return fs
      .readdirSync(packsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/** Load one bundled pack by name, or null if unknown/unreadable. */
export function readPack(name: string, packsDir = PACKS_DIR): Pack | null {
  // Pack names are config-controlled; constrain the charset so a crafted name
  // can never traverse out of the packs directory.
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(packsDir, `${name}.json`), "utf8")) as Pack;
  } catch {
    return null;
  }
}

/**
 * Compose the effective guard set: DEFAULT_POLICY rules, then each active pack,
 * then the user's local policy.json rules (local last, so a local rule can layer
 * on top). Session checks come only from packs.
 */
export function resolvePractices(root: string, cfg: Config, packsDir = PACKS_DIR): EffectiveGuard {
  const rules: Rule[] = [...DEFAULT_POLICY.rules];
  const checks: SessionCheck[] = [];
  for (const name of cfg.guard.practices ?? []) {
    const pack = readPack(name, packsDir);
    if (!pack) continue;
    if (pack.rules) rules.push(...pack.rules);
    if (pack.checks) checks.push(...pack.checks);
  }
  const local = readJsonOr<{ rules?: Rule[] }>(brain(root).policy, {});
  if (Array.isArray(local.rules)) rules.push(...local.rules);
  return { rules, checks };
}

/** Regenerate .packmind/guard.effective.json from the current config + packs. */
export function writeEffective(root: string, cfg: Config, packsDir = PACKS_DIR): void {
  writeJson(brain(root).effective, resolvePractices(root, cfg, packsDir));
}
