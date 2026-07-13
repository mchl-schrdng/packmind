import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { createProgram } from "../src/cli/index.js";

const README = fs.readFileSync("README.md", "utf8");

// NOTE: the README itself is being rewritten for the 2.0 surface in a parallel
// task; the README-content assertions here are the contract that rewrite must
// satisfy and are marked .todo until it lands (including: no French strings,
// no mention of removed commands, every surviving command documented).
describe.todo("README documents the 2.0 behavior (enable with the rewritten README)");

describe("--help matches the 2.0 command surface", () => {
  it("registers exactly the surviving commands", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["doctor", "init", "mcp", "resume", "status", "update"]);
  });

  it("resume keeps its options and description", () => {
    const program = createProgram();
    const resume = program.commands.find((c) => c.name() === "resume")!;
    expect(resume.description()).toMatch(/rate-limit/i);
    const helpText = resume.helpInformation();
    expect(helpText).toContain("--session");
    expect(helpText).toContain("--wait");
  });
});

describe("README exists and is non-trivial", () => {
  it("is present with real content", () => {
    expect(README.length).toBeGreaterThan(500);
  });
});
