import * as fs from "node:fs";
import { readJsonStrict, writeJson } from "../util/fs-atomic.js";
import { onWindows } from "../util/platform.js";

/**
 * Integration with Claude Code. PackMind installs two things into a project:
 *   1. Lifecycle hooks in .claude/settings.json, tagged `_managedBy: "packmind"`
 *      so Claude Code preserves them and PackMind can dedupe/remove cleanly.
 *      Commands are guarded so a missing hook file no-ops instead of erroring.
 *   2. An MCP server entry in .mcp.json exposing the brain as queryable tools.
 */
export const MANAGED_BY = "packmind";
const HOOKS = "$CLAUDE_PROJECT_DIR/.packmind/hooks";

interface HookCmd {
  type: "command";
  command: string;
  timeout: number;
}
interface HookGroup {
  matcher: string;
  hooks: HookCmd[];
  _managedBy?: string;
}
type HookMap = Record<string, HookGroup[]>;

function cmd(script: string, timeout: number): HookCmd {
  const p = `${HOOKS}/${script}`;
  return {
    type: "command",
    command: onWindows ? `node "${p}"` : `[ -f "${p}" ] && node "${p}" || true`,
    timeout,
  };
}
function group(matcher: string, script: string, timeout: number): HookGroup {
  return { matcher, hooks: [cmd(script, timeout)], _managedBy: MANAGED_BY };
}

export function buildHookMap(): HookMap {
  return {
    SessionStart: [group("", "session-start.js", 5)],
    UserPromptSubmit: [group("", "prompt-submit.js", 5)],
    PreToolUse: [
      group("Read", "pre-read.js", 5),
      group("Write|Edit|MultiEdit", "pre-write.js", 5),
    ],
    PostToolUse: [
      group("Read", "post-read.js", 5),
      group("Write|Edit|MultiEdit", "post-write.js", 10),
    ],
    Stop: [group("", "stop.js", 10)],
  };
}

function stripManaged(existing: HookMap): HookMap {
  const out: HookMap = {};
  for (const [event, groups] of Object.entries(existing)) {
    const kept = (groups ?? []).filter((g) => g?._managedBy !== MANAGED_BY);
    if (kept.length) out[event] = kept;
  }
  return out;
}

/** Copy a user-owned file to a `.packmind-bak` sibling before we first rewrite it. */
function backupOnce(target: string): void {
  const bak = `${target}.packmind-bak`;
  try {
    if (fs.existsSync(target) && !fs.existsSync(bak)) fs.copyFileSync(target, bak);
  } catch {
    /* best effort */
  }
}

export function registerHooks(settingsPath: string): void {
  // Strict read: if settings.json exists but is malformed, throw rather than
  // overwrite it with only our hooks (which would wipe the user's permissions,
  // env, and any hooks they authored themselves).
  const settings = readJsonStrict<Record<string, unknown>>(settingsPath, {});
  backupOnce(settingsPath);
  const merged = stripManaged((settings.hooks as HookMap) ?? {});
  for (const [event, groups] of Object.entries(buildHookMap())) {
    merged[event] = [...(merged[event] ?? []), ...groups];
  }
  settings.hooks = merged;
  writeJson(settingsPath, settings);
}

export function unregisterHooks(settingsPath: string): void {
  const settings = readJsonStrict<Record<string, unknown>>(settingsPath, {});
  settings.hooks = stripManaged((settings.hooks as HookMap) ?? {});
  writeJson(settingsPath, settings);
}

/** Register the PackMind MCP server in a project's .mcp.json (preserving others). */
export function registerMcp(mcpJsonPath: string): void {
  const config = readJsonStrict<{ mcpServers?: Record<string, unknown> }>(mcpJsonPath, {});
  backupOnce(mcpJsonPath);
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers.packmind = { command: "packmind", args: ["mcp"] };
  writeJson(mcpJsonPath, config);
}
