import * as path from "node:path";
import { readJsonOr } from "../util/fs-atomic.js";
import { confineToRoot } from "../guard/path-guard.js";

/**
 * PackMind configuration. The on-disk config.json is always DEEP-MERGED over
 * these defaults, which gives two guarantees:
 *   1. Forward compatibility - a config written by an older version never
 *      crashes a newer accessor (missing keys fall back to defaults).
 *   2. Preservation - `packmind update` can introduce new keys without
 *      clobbering values the user customized (e.g. their chosen model).
 */
export interface Config {
  version: number;
  guard: {
    /** Hard-block writes that target a secret file (opt-in). */
    blockSecrets: boolean;
    /** Extra globs treated as secret files on top of the built-in denylist. */
    extraSecretGlobs: string[];
  };
  claude: {
    settingsPath: string;
    claudeMdPath: string;
  };
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  guard: { blockSecrets: false, extraSecretGlobs: [] },
  claude: {
    settingsPath: ".claude/settings.json",
    claudeMdPath: "CLAUDE.md",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively merge `patch` onto `base`; arrays and scalars are replaced. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : (patch as T);
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? deepMerge(merged[key], value)
      : value;
  }
  return merged as T;
}

/**
 * A config-supplied path that must stay inside the project. Absolute paths and
 * any value that resolves outside the root (via `..`) are rejected and fall back
 * to the default, so a malicious `.packmind/config.json` can't redirect
 * `packmind init`/`update` to write over files elsewhere on disk.
 */
function safeProjectPath(root: string, candidate: unknown, fallback: string): string {
  if (typeof candidate !== "string" || !candidate || path.isAbsolute(candidate) || confineToRoot(root, candidate) === null) {
    if (candidate !== undefined && candidate !== fallback) {
      console.warn(`packmind: ignoring unsafe config path "${String(candidate)}"; using "${fallback}".`);
    }
    return fallback;
  }
  return candidate;
}

export function loadConfig(configPath: string): Config {
  const cfg = deepMerge(DEFAULT_CONFIG, readJsonOr<Partial<Config>>(configPath, {}));
  // config.json lives at <root>/.packmind/config.json, so the root is two up.
  const root = path.resolve(path.dirname(configPath), "..");
  cfg.claude.settingsPath = safeProjectPath(root, cfg.claude.settingsPath, DEFAULT_CONFIG.claude.settingsPath);
  cfg.claude.claudeMdPath = safeProjectPath(root, cfg.claude.claudeMdPath, DEFAULT_CONFIG.claude.claudeMdPath);
  return cfg;
}
