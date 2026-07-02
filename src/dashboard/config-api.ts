import { deepMerge, type Config } from "../state/schema.js";

/**
 * The subset of config.json the dashboard is allowed to edit, keyed by dotted
 * path with its expected JS type. Anything not listed here is rejected - the UI
 * never touches `cost.prices`, `claude.*`, `version`, or `map.excludeDirs`.
 */
export type FieldType = "string" | "boolean" | "number" | "exact" | "stringArray" | "leanMode";

export const ALLOWED_CONFIG_KEYS: Record<string, FieldType> = {
  model: "string",
  "recall.enabled": "boolean",
  "recall.embedModel": "string",
  "recall.chunkChars": "number",
  "recall.topK": "number",
  "guard.blockSecrets": "boolean",
  "guard.lean.mode": "leanMode",
  "map.maxFiles": "number",
  "map.autoScanOnInit": "boolean",
  "map.respectGitignore": "boolean",
  "map.extraSecretGlobs": "stringArray",
  "cost.exact": "exact",
};

function typeOk(type: FieldType, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "exact":
      return value === "auto" || value === "never" || value === "always";
    case "leanMode":
      return value === "off" || value === "lite" || value === "full";
    case "stringArray":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
}

function setPath(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof node[k] !== "object" || node[k] === null || Array.isArray(node[k])) node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

export interface PatchResult {
  config: Record<string, unknown>;
  errors: string[];
}

/**
 * Apply a flat, dotted-key patch (e.g. {"recall.topK": 8}) onto the raw on-disk
 * config object. Every key must be whitelisted and well-typed; otherwise it is
 * rejected and recorded in `errors` (so the server can answer 400 and write
 * nothing). Untouched keys are preserved via deepMerge.
 */
export function applyConfigPatch(onDisk: unknown, patch: unknown): PatchResult {
  const errors: string[] = [];
  const base: Record<string, unknown> =
    typeof onDisk === "object" && onDisk !== null && !Array.isArray(onDisk)
      ? { ...(onDisk as Record<string, unknown>) }
      : {};

  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return { config: base, errors: ["patch must be an object of dotted config keys"] };
  }

  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const type = ALLOWED_CONFIG_KEYS[key];
    if (!type) {
      errors.push(`"${key}" is not an editable config key`);
      continue;
    }
    if (!typeOk(type, value)) {
      errors.push(`"${key}" must be of type ${type}`);
      continue;
    }
    setPath(nested, key, value);
  }

  if (errors.length) return { config: base, errors };
  return { config: deepMerge(base, nested) as Record<string, unknown>, errors };
}

export interface HookRow {
  event: string;
  matcher: string;
  command: string;
  timeout: number | null;
  managed: boolean;
}
export interface McpRow {
  name: string;
  command: string;
  args: string[];
}

/**
 * Flatten `.claude/settings.json` hooks and `.mcp.json` servers into flat rows
 * for the read-only "Claude Code" view. Mirrors the parsing in cli/doctor.ts.
 */
export function summarizeClaudeConfig(
  settings: unknown,
  mcp: unknown,
): { hooks: HookRow[]; mcpServers: McpRow[] } {
  const hooks: HookRow[] = [];
  const hookMap = (settings as { hooks?: Record<string, unknown> })?.hooks ?? {};
  for (const [event, groups] of Object.entries(hookMap)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const g = group as { matcher?: string; hooks?: unknown[]; _managedBy?: string };
      for (const cmd of Array.isArray(g.hooks) ? g.hooks : []) {
        const c = cmd as { command?: string; timeout?: number };
        hooks.push({
          event,
          matcher: g.matcher ?? "",
          command: c.command ?? "",
          timeout: typeof c.timeout === "number" ? c.timeout : null,
          managed: g._managedBy === "packmind",
        });
      }
    }
  }

  const mcpServers: McpRow[] = [];
  const servers = (mcp as { mcpServers?: Record<string, unknown> })?.mcpServers ?? {};
  for (const [name, cfg] of Object.entries(servers)) {
    const c = cfg as { command?: string; args?: unknown[] };
    mcpServers.push({
      name,
      command: c.command ?? "",
      args: Array.isArray(c.args) ? c.args.map(String) : [],
    });
  }

  return { hooks, mcpServers };
}

/** Re-export so the server keeps a single import surface for config types. */
export type { Config };
