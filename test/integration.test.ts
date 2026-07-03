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
    const merged = deepMerge(DEFAULT_CONFIG, { model: "claude-haiku-4-5", recall: { topK: 99 } });
    expect(merged.model).toBe("claude-haiku-4-5");
    expect(merged.recall.topK).toBe(99);
    expect(merged.recall.enabled).toBe(true); // untouched default
    expect(merged.guard.blockSecrets).toBe(false);
  });
  it("loadConfig fills defaults for a partial file", () => {
    const dir = tmp();
    const p = path.join(dir, "config.json");
    fs.writeFileSync(p, JSON.stringify({ version: 1, model: "claude-sonnet-4-6" }));
    const c = loadConfig(p);
    expect(c.model).toBe("claude-sonnet-4-6");
    expect(c.map.maxFiles).toBe(DEFAULT_CONFIG.map.maxFiles);
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
      expect.arrayContaining(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]),
    );
    const tagged = Object.values(s.hooks).flat().filter((g: any) => g._managedBy === MANAGED_BY);
    expect(tagged.length).toBeGreaterThanOrEqual(7);
  });

  it("is idempotent and preserves user hooks", () => {
    const dir = tmp();
    const p = path.join(dir, "settings.json");
    fs.writeFileSync(p, JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "mine" }] }] } }));
    registerHooks(p);
    registerHooks(p);
    const s = readJson(p);
    const tagged = Object.values(s.hooks).flat().filter((g: any) => g._managedBy === MANAGED_BY);
    const mine = s.hooks.Stop.filter((g: any) => g._managedBy !== MANAGED_BY);
    expect(mine).toHaveLength(1);
    const stopTagged = s.hooks.Stop.filter((g: any) => g._managedBy === MANAGED_BY);
    expect(stopTagged).toHaveLength(1); // not duplicated
    unregisterHooks(p);
    const after = readJson(p);
    expect(Object.values(after.hooks).flat().filter((g: any) => g._managedBy === MANAGED_BY)).toHaveLength(0);
    expect(after.hooks.Stop[0].hooks[0].command).toBe("mine");
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
    expect(s.mcpServers.packmind).toEqual({ command: "packmind", args: ["mcp"] });
    expect(s.mcpServers.other).toEqual({ command: "x" });
  });
});
