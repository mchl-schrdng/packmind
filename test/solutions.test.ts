import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeContext, toolRecordSolution } from "../src/mcp/tools.js";
import { brain } from "../src/state/files.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sol-"));
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "recall"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.solutions, "[]");
  return dir;
}

describe("record_solution de-duplication", () => {
  it("bumps occurrences for the same error instead of duplicating", () => {
    const dir = project();
    const ctx = makeContext(dir);
    toolRecordSolution(ctx, { error: "TypeError: cannot read map of undefined", fix: "optional chaining" });
    const msg = toolRecordSolution(ctx, { error: "TypeError: cannot read MAP of undefined!", cause: "null api response" });

    const list = JSON.parse(fs.readFileSync(brain(dir).solutions, "utf8"));
    expect(list).toHaveLength(1);
    expect(list[0].occurrences).toBe(2);
    expect(list[0].fix).toBe("optional chaining"); // preserved
    expect(list[0].cause).toBe(""); // first-write empty stays unless filled — cause only set on create
    expect(msg).toMatch(/seen 2 times/);
  });

  it("records distinct errors separately with occurrences=1", () => {
    const dir = project();
    const ctx = makeContext(dir);
    toolRecordSolution(ctx, { error: "build fails on windows" });
    toolRecordSolution(ctx, { error: "tests flaky on CI" });
    const list = JSON.parse(fs.readFileSync(brain(dir).solutions, "utf8"));
    expect(list).toHaveLength(2);
    expect(list.every((s: any) => s.occurrences === 1)).toBe(true);
  });
});
