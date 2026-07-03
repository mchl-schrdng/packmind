import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../src/state/snapshot.js";
import { rateFor, inputCost } from "../src/cost/pricing.js";
import { mapIsStale, scanProject } from "../src/state/mapper.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import { brain } from "../src/state/files.js";

function seedBrain(dir: string): void {
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "recall"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.knowledge, "# Knowledge\nv1\n");
}

describe("[P2] restore is exact (no stale overlay)", () => {
  it("removes files created after the snapshot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rex-"));
    seedBrain(dir);
    createSnapshot(dir, "snap");

    // Create a file that did NOT exist at snapshot time.
    fs.writeFileSync(path.join(brain(dir).dir, "extra-stale.json"), "{}");
    fs.writeFileSync(brain(dir).knowledge, "# Knowledge\nMODIFIED\n");

    expect(restoreSnapshot(dir, "snap")).toBe(true);
    expect(fs.existsSync(path.join(brain(dir).dir, "extra-stale.json"))).toBe(false); // gone
    expect(fs.readFileSync(brain(dir).knowledge, "utf8")).toContain("v1"); // reverted
  });
});

describe("[P2] backups don't collide across same-named projects", () => {
  it("two 'app' folders in different paths keep separate backups", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-coll-"));
    const a = path.join(root, "one", "app");
    const b = path.join(root, "two", "app");
    for (const d of [a, b]) {
      fs.mkdirSync(d, { recursive: true });
      seedBrain(d);
    }
    createSnapshot(a, "from-a");
    createSnapshot(b, "from-b");
    expect(listSnapshots(a)).toEqual(["from-a"]);
    expect(listSnapshots(b)).toEqual(["from-b"]); // not mixed together
  });
});

describe("[P1] pricing overrides actually apply", () => {
  it("config price override changes the rate and cost", () => {
    const base = rateFor("claude-opus-4-8");
    expect(base.inputPerMTok).toBe(5);
    const ov = { "claude-opus-4-8": { inputPerMTok: 99, outputPerMTok: 200 } };
    expect(rateFor("claude-opus-4-8", ov).inputPerMTok).toBe(99);
    expect(inputCost("claude-opus-4-8", 1_000_000, ov)).toBeCloseTo(99, 6);
    // unrelated models still use defaults
    expect(rateFor("claude-haiku-4-5", ov).inputPerMTok).toBe(1);
  });
});

describe("[P2] staleness is robust to exact-vs-estimate token counts", () => {
  it("an exact-counted map of unchanged files is NOT stale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-stale-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(brain(dir).dir, "recall"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    const config = { ...DEFAULT_CONFIG, map: { ...DEFAULT_CONFIG.map, respectGitignore: false } };

    // Write a map with deliberately "exact" (different) token numbers, as
    // `scan --exact` would, then ensure mtime-based staleness ignores the
    // estimate/exact difference.
    scanProject(dir, config);
    const mapText = fs.readFileSync(brain(dir).map, "utf8").replace(/~\d+ tok/g, "~9999 tok");
    fs.writeFileSync(brain(dir).map, mapText);

    expect(mapIsStale(dir, config)).toBe(false); // unchanged sources → not stale
  });
});
