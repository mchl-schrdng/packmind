import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerHooks, unregisterHooks, registerMcp, MANAGED_BY } from "../src/adapters/claude-code.js";
import { deepMerge, DEFAULT_CONFIG, loadConfig } from "../src/state/schema.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-int-"));
}
function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

describe("config deep-merge (preservation + forward-compat)", () => {
  it("preserves user values and adds new keys", () => {
    const merged = deepMerge(DEFAULT_CONFIG, { guard: { blockSecrets: true } });
    expect(merged.guard.blockSecrets).toBe(true);
    expect(merged.guard.extraSecretGlobs).toEqual([]); // untouched default
    expect(merged.claude.settingsPath).toBe(".claude/settings.json");
  });
  it("loadConfig fills defaults for a partial file (and tolerates 1.0-era keys)", () => {
    const dir = tmp();
    const p = path.join(dir, "config.json");
    // A config written by an older version: extra keys must not crash accessors.
    fs.writeFileSync(p, JSON.stringify({ version: 1, model: "claude-sonnet-4-6", recall: { topK: 99 } }));
    const c = loadConfig(p);
    expect(c.guard.blockSecrets).toBe(false);
    expect(c.guard.extraSecretGlobs).toEqual([]);
    expect(c.claude.settingsPath).toBe(".claude/settings.json");
  });
});

describe("Claude Code adapter", () => {
  it("registers tagged hooks across all events", () => {
    const dir = tmp();
    const p = path.join(dir, "settings.json");
    fs.writeFileSync(p, "{}");
    registerHooks(p);
    const s = readJson(p);
    expect(Object.keys(s.hooks)).toEqual(
      expect.arrayContaining(["SessionStart", "UserPromptSubmit", "PreToolUse", "StopFailure"]),
    );
    const tagged = Object.values(s.hooks).flat().filter((g: any) => g._managedBy === MANAGED_BY);
    expect(tagged.length).toBe(4);
  });

  it("is idempotent and preserves user hooks", () => {
    const dir = tmp();
    const p = path.join(dir, "settings.json");
    fs.writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "mine" }] }] } }));
    registerHooks(p);
    registerHooks(p);
    const s = readJson(p);
    const mine = s.hooks.SessionStart.filter((g: any) => g._managedBy !== MANAGED_BY);
    expect(mine).toHaveLength(1);
    const startTagged = s.hooks.SessionStart.filter((g: any) => g._managedBy === MANAGED_BY);
    expect(startTagged).toHaveLength(1); // not duplicated
    unregisterHooks(p);
    const after = readJson(p);
    expect(Object.values(after.hooks).flat().filter((g: any) => g._managedBy === MANAGED_BY)).toHaveLength(0);
    expect(after.hooks.SessionStart[0].hooks[0].command).toBe("mine");
  });

  it("refuses to clobber a settings.json that exists but is malformed", () => {
    const dir = tmp();
    const p = path.join(dir, "settings.json");
    // A real-world corruption: a trailing comma the user left behind.
    const malformed = '{ "permissions": { "allow": ["Bash"] }, }';
    fs.writeFileSync(p, malformed);
    expect(() => registerHooks(p)).toThrow(/not valid JSON/);
    // The user's file is left exactly as it was, not overwritten with our hooks.
    expect(fs.readFileSync(p, "utf8")).toBe(malformed);
  });

  it("registers the MCP server without clobbering others", () => {
    const dir = tmp();
    const p = path.join(dir, ".mcp.json");
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    registerMcp(p);
    const s = readJson(p);
    expect(s.mcpServers.packmind).toEqual({ command: "npx", args: ["packmind", "mcp"] });
    expect(s.mcpServers.other).toEqual({ command: "x" });
  });
});
