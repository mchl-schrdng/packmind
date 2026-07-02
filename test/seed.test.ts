import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { seedBrainFiles, CREATE_IF_MISSING } from "../src/cli/seed.js";

/**
 * seedBrainFiles is shared by init and update. It must create any missing brain
 * file (so an upgraded install regains, e.g., policy.json and its default secret
 * warning), never clobber a file the user already has, and write a .gitignore so
 * per-developer state does not get committed.
 */
describe("seedBrainFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-seed-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates every missing brain file plus .gitattributes/.gitignore", () => {
    seedBrainFiles(dir);
    for (const f of CREATE_IF_MISSING) expect(fs.existsSync(path.join(dir, f))).toBe(true);
    expect(fs.existsSync(path.join(dir, "policy.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".gitattributes"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toMatch(/recall\//);
  });

  it("does not overwrite a brain file the user already has", () => {
    const custom = "# Knowledge\n\n## Notes\n- keep me\n";
    fs.writeFileSync(path.join(dir, "knowledge.md"), custom);
    seedBrainFiles(dir);
    expect(fs.readFileSync(path.join(dir, "knowledge.md"), "utf8")).toBe(custom);
  });
});
