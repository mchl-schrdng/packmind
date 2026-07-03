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
  model: string;
  map: {
    autoScanOnInit: boolean;
    maxFiles: number;
    respectGitignore: boolean;
    excludeDirs: string[];
    extraSecretGlobs: string[];
  };
  cost: {
    /** "auto": exact when ANTHROPIC_API_KEY present, else estimate. */
    exact: "auto" | "never" | "always";
    /** Per-model USD/Mtok overrides for the built-in pricing defaults. */
    prices: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
  };
  recall: {
    enabled: boolean;
    embedModel: string;
    chunkChars: number;
    topK: number;
  };
  guard: {
    /** Hard-block writes that target a secret file (opt-in). */
    blockSecrets: boolean;
    /** Lean mode: nudge toward reuse-first, minimal solutions before writing. */
    lean: { mode: "off" | "lite" | "full" };
    /** Active practice packs (names under templates/packs/), composed into the guard set. */
    practices: string[];
  };
  claude: {
    settingsPath: string;
    claudeMdPath: string;
  };
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  model: "claude-opus-4-8",
  map: {
    autoScanOnInit: true,
    maxFiles: 600,
    respectGitignore: true,
    excludeDirs: [
      "node_modules", ".git", ".packmind", ".claude", "dist", "build", "out",
      ".next", ".nuxt", ".svelte-kit", "coverage", "__pycache__", ".cache",
      "target", ".venv", "vendor", ".turbo", ".vercel", ".idea", ".vscode",
    ],
    extraSecretGlobs: [],
  },
  cost: { exact: "never", prices: {} },
  recall: {
    enabled: true,
    embedModel: "Xenova/all-MiniLM-L6-v2",
    chunkChars: 1200,
    topK: 6,
  },
  guard: { blockSecrets: false, lean: { mode: "lite" }, practices: [] },
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
