import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runInit } from "../src/cli/init.js";
import { buildHookMap } from "../src/adapters/claude-code.js";

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

    // The compiled hook must be copied into the project (else the registered
    // SessionEnd hook points at a file that never gets installed).
    expect(fs.existsSync(path.join(dir, ".packmind", "hooks", "session-end.js"))).toBe(true);

    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionEnd).toBeTruthy();
    expect(JSON.stringify(settings.hooks.SessionEnd)).toContain("session-end.js");
  });
});
