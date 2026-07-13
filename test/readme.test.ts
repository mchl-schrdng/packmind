import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { createProgram } from "../src/cli/index.js";

const README = fs.readFileSync("README.md", "utf8");

const ALLOWED_COMMANDS = ["init", "status", "doctor", "update", "resume", "mcp"];
const REMOVED_COMMANDS = [
  "scan",
  "index",
  "insights",
  "recall",
  "backup",
  "maintain",
  "dashboard",
  "debt",
  "changes",
  "policy",
  "practice",
  "solutions",
  "upgrade",
];

describe("README documents the v2 surface", () => {
  it("carries the positioning line", () => {
    expect(README).toContain(
      "PackMind resumes your rate-limited Claude Code session and gives your team a committed project memory Claude reads automatically."
    );
  });

  it("has every mandatory section", () => {
    for (const heading of [
      "Why PackMind",
      "Install",
      "Resuming a rate-limited session",
      "Team memory",
      "Guardrails",
      "CLI commands",
      "Security and privacy",
      "Limits",
      "Uninstall",
    ]) {
      expect(README, `missing section: ${heading}`).toMatch(
        new RegExp(`^#{1,3} .*${heading}`, "im")
      );
    }
  });

  it("only documents commands that exist, and documents all of them", () => {
    const documented = new Set(
      [...README.matchAll(/packmind ([a-z-]+)/g)].map((m) => m[1])
    );
    for (const cmd of documented) {
      expect(ALLOWED_COMMANDS, `README documents unknown command: packmind ${cmd}`).toContain(cmd);
    }
    for (const cmd of ALLOWED_COMMANDS) {
      expect(documented, `README never shows: packmind ${cmd}`).toContain(cmd);
    }
  });

  it("never invokes a removed command", () => {
    for (const cmd of REMOVED_COMMANDS) {
      expect(README, `README still mentions removed command: packmind ${cmd}`).not.toMatch(
        new RegExp(`packmind ${cmd}\\b`)
      );
    }
  });

  it("shows the resume lifecycle in the mermaid diagram", () => {
    const mermaid = README.match(/```mermaid([\s\S]*?)```/)?.[1] ?? "";
    for (const node of [
      "StopFailure: rate_limit",
      "packmind resume",
      "Reset time reached?",
      "claude --resume session-id",
    ]) {
      expect(mermaid, `missing mermaid node: ${node}`).toContain(node);
    }
  });

  it("states the resume guarantees", () => {
    expect(README).toMatch(/explicit user action/i);
    expect(README).toMatch(/does not bypass usage limits?/i);
    expect(README).toMatch(/never launches Claude/i);
    expect(README).toMatch(/no daemon/i);
  });

  it("contains no em dashes and no French text", () => {
    expect(README).not.toMatch(/[–—]/);
    expect(README).not.toMatch(/[àâäçèéêëîïôöùûüœ]/i);
  });
});

describe("CLI registry matches the documented surface", () => {
  it("registers exactly the documented commands", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name()).filter((n) => n !== "help");
    expect(names.sort()).toEqual([...ALLOWED_COMMANDS].sort());
  });

  it("resume keeps its flags", () => {
    const program = createProgram();
    const resume = program.commands.find((c) => c.name() === "resume")!;
    expect(resume.description()).toMatch(/rate.?limit/i);
    const helpText = resume.helpInformation();
    expect(helpText).toContain("--session");
    expect(helpText).toContain("--wait");
  });
});
