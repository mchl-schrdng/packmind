import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runInit } from "../src/cli/init.js";
import { runUpdate } from "../src/cli/update.js";
import { buildHookMap, HOOK_SCRIPTS } from "../src/adapters/claude-code.js";

const built = fs.existsSync(path.resolve("dist/hooks/session-end.js"));

describe("adapter registers the SessionEnd hook", () => {
  it("buildHookMap includes SessionEnd -> session-end.js", () => {
    const map = buildHookMap();
    expect(map.SessionEnd).toBeTruthy();
    expect(JSON.stringify(map.SessionEnd)).toContain("session-end.js");
  });
});

describe.skipIf(!built)("[P1] init installs session-end.js (adapter registers a hook projects must receive)", () => {
  it("copies session-end.js into .packmind/hooks and registers the SessionEnd hook", () => {
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
    for (const script of ["session-end.js", "post-tool-batch.js", "file-changed.js", "stop-failure.js"]) {
      expect(fs.existsSync(path.join(dir, ".packmind", "hooks", script))).toBe(true);
    }

    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings.hooks.SessionEnd)).toContain("session-end.js");
    expect(JSON.stringify(settings.hooks.PostToolBatch)).toContain("post-tool-batch.js");
    expect(JSON.stringify(settings.hooks.FileChanged)).toContain("file-changed.js");
    expect(JSON.stringify(settings.hooks.StopFailure)).toContain("stop-failure.js");
  });
});

describe("buildHookMap registers every shipped lifecycle event", () => {
  it("has an entry for each new event so doctor's matrix check can verify it", () => {
    const map = buildHookMap();
    for (const [event, script] of [
      ["SessionStart", "session-start.js"],
      ["SessionEnd", "session-end.js"],
      ["PostToolBatch", "post-tool-batch.js"],
      ["FileChanged", "file-changed.js"],
      ["Stop", "stop.js"],
      ["StopFailure", "stop-failure.js"],
    ] as const) {
      expect(JSON.stringify(map[event] ?? []), event).toContain(script);
    }
  });

  it("StopFailure is registered with the exact rate_limit matcher", () => {
    const map = buildHookMap();
    expect(map.StopFailure[0].matcher).toBe("rate_limit");
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

describe.skipIf(!built)("[P1] update installs newly-shipped hooks (0.9.x -> 1.0 upgrade path)", () => {
  it("packmind update copies stop-failure.js into an existing project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-update-"));
    const prev = process.env.PACKMIND_ROOT;
    const log = console.log;
    process.env.PACKMIND_ROOT = dir;
    console.log = () => {};
    try {
      runInit();
      // Simulate a 0.9.2 install: the hook file does not exist yet.
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
