import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { createProgram } from "../src/cli/index.js";

const README = fs.readFileSync("README.md", "utf8");

describe("README documents the v1 behavior", () => {
  it("carries the positioning line", () => {
    expect(README).toContain("A local second brain for Claude Code.");
  });

  it("has every mandatory section", () => {
    for (const heading of [
      "How it works",
      "Resuming after a rate limit",
      "CLI commands",
      "MCP tools",
      "Maintenance via cron",
      "Local data & privacy",
      "Known limitations",
      "Uninstall",
    ]) {
      expect(README, `missing section: ${heading}`).toMatch(new RegExp(`^#{1,3} .*${heading}`, "im"));
    }
  });

  it("contains the mandatory Mermaid nodes", () => {
    const mermaid = README.match(/```mermaid([\s\S]*?)```/)?.[1] ?? "";
    for (const node of [
      "User runs Claude Code",
      "PackMind lifecycle hooks",
      "Local .packmind state",
      "PackMind MCP tools",
      "StopFailure: rate_limit",
      "Local resume ticket",
      "packmind resume --wait",
      "Reset time reached?",
      "Foreground countdown",
      "claude --resume session-id",
      "Ask user to retry after reset",
      "User-configured cron",
      "packmind maintain --quiet",
    ]) {
      expect(mermaid, `missing mermaid node: ${node}`).toContain(node);
    }
  });

  it("states the guarantees under the diagram and the crontab non-management", () => {
    expect(README).toMatch(/explicit user action/i);
    expect(README).toMatch(/does not bypass .*limits?/i);
    expect(README).toMatch(/never launches Claude/i);
    expect(README).toMatch(/no .*daemon/i);
    expect(README).toMatch(/never creates, modifies, or deletes .*crontab/i);
    expect(README).toContain("0 2 * * *");
  });

  it("documents resume and maintain commands", () => {
    for (const s of [
      "packmind resume",
      "packmind resume --session",
      "packmind resume --wait",
      "packmind maintain --quiet",
      "packmind maintain --keep-backups",
    ]) {
      expect(README).toContain(s);
    }
  });
});

describe("--help covers resume and maintain", () => {
  it("registers both commands with descriptions", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("resume");
    expect(names).toContain("maintain");
    const resume = program.commands.find((c) => c.name() === "resume")!;
    expect(resume.description()).toMatch(/rate-limit/i);
    const helpText = resume.helpInformation();
    expect(helpText).toContain("--session");
    expect(helpText).toContain("--wait");
  });
});
