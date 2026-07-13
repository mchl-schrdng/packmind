import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runInit } from "../src/cli/init.js";
import { runUpdate } from "../src/cli/update.js";
import { buildHookMap, HOOK_SCRIPTS } from "../src/adapters/claude-code.js";

const built = fs.existsSync(path.resolve("dist/hooks/stop-failure.js"));

describe.skipIf(!built)("[P1] init installs every registered hook script", () => {
  it("copies each hook into .packmind/hooks and registers its event", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-install-"));
    const prev = process.env.PACKMIND_ROOT;
    const log = console.log;
    process.env.PACKMIND_ROOT = dir;
    console.log = () => {}; // silence init banner
    try {
      runInit();
    } finally {
      if (prev === undefined) delete process.env.PACKMIND_ROOT;
      else process.env.PACKMIND_ROOT = prev;
      console.log = log;
    }

    // Every registered hook script must be copied into the project (else the
    // registered hook points at a file that never gets installed).
    for (const script of HOOK_SCRIPTS) {
      expect(fs.existsSync(path.join(dir, ".packmind", "hooks", script)), script).toBe(true);
    }

    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("session-start.js");
    expect(JSON.stringify(settings.hooks.UserPromptSubmit)).toContain("prompt-submit.js");
    expect(JSON.stringify(settings.hooks.PreToolUse)).toContain("pre-write.js");
    expect(JSON.stringify(settings.hooks.StopFailure)).toContain("stop-failure.js");

    // The MCP server is registered through npx so a project-local (non-global)
    // install still resolves the bin when Claude Code spawns it.
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.packmind).toEqual({ command: "npx", args: ["packmind", "mcp"] });
  });
});

describe("buildHookMap registers every shipped lifecycle event", () => {
  it("has an entry for each event so doctor's matrix check can verify it", () => {
    const map = buildHookMap();
    for (const [event, script] of [
      ["SessionStart", "session-start.js"],
      ["UserPromptSubmit", "prompt-submit.js"],
      ["PreToolUse", "pre-write.js"],
      ["StopFailure", "stop-failure.js"],
    ] as const) {
      expect(JSON.stringify(map[event] ?? []), event).toContain(script);
    }
    // And nothing else: a registered event whose hook was removed would be a
    // silent no-op pointing at a file init never copies.
    expect(Object.keys(map).sort()).toEqual(["PreToolUse", "SessionStart", "StopFailure", "UserPromptSubmit"]);
  });

  it("StopFailure is registered with the exact rate_limit matcher", () => {
    const map = buildHookMap();
    expect(map.StopFailure[0].matcher).toBe("rate_limit");
  });

  it("PreToolUse only matches write-shaped tools", () => {
    const map = buildHookMap();
    expect(map.PreToolUse[0].matcher).toBe("Write|Edit|MultiEdit");
  });

  it("every script buildHookMap references is in the canonical HOOK_SCRIPTS list", () => {
    // The install/update/doctor copy list and the registration map must never
    // drift apart again - a registered-but-never-copied hook is a silent no-op.
    for (const groups of Object.values(buildHookMap())) {
      for (const g of groups) {
        for (const h of g.hooks) {
          const script = h.command.match(/([a-z0-9-]+\.js)/)?.[1];
          expect(script && HOOK_SCRIPTS.includes(script), `${script} missing from HOOK_SCRIPTS`).toBe(true);
        }
      }
    }
  });
});

describe.skipIf(!built)("[P1] update installs newly-shipped hooks", () => {
  it("packmind update copies a missing hook script into an existing project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-update-"));
    const prev = process.env.PACKMIND_ROOT;
    const log = console.log;
    process.env.PACKMIND_ROOT = dir;
    console.log = () => {};
    try {
      runInit();
      // Simulate an older install: the hook file does not exist yet.
      fs.rmSync(path.join(dir, ".packmind", "hooks", "stop-failure.js"), { force: true });
      runUpdate();
      expect(fs.existsSync(path.join(dir, ".packmind", "hooks", "stop-failure.js"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PACKMIND_ROOT;
      else process.env.PACKMIND_ROOT = prev;
      console.log = log;
    }
  });
});
