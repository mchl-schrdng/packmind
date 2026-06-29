import { readJsonOr } from "../util/fs-atomic.js";

/**
 * PackMind configuration. The on-disk config.json is always DEEP-MERGED over
 * these defaults, which gives two guarantees:
 *   1. Forward compatibility — a config written by an older version never
 *      crashes a newer accessor (missing keys fall back to defaults).
 *   2. Preservation — `packmind update` can introduce new keys without
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
  cost: { exact: "auto", prices: {} },
  recall: {
    enabled: true,
    embedModel: "Xenova/all-MiniLM-L6-v2",
    chunkChars: 1200,
    topK: 6,
  },
  guard: { blockSecrets: false },
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

export function loadConfig(configPath: string): Config {
  return deepMerge(DEFAULT_CONFIG, readJsonOr<Partial<Config>>(configPath, {}));
}
