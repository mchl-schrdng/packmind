import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VectorStore, cosine } from "../src/recall/store.js";

const rec = (id: string, vector: number[]) => ({ id, source: "s", kind: "code", text: "t", vector });

describe("VectorStore model invalidation", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-vec-"));
    file = path.join(dir, "vectors.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps records when reopened with the same model", () => {
    const a = new VectorStore(file, "model-a");
    a.upsertBySource([rec("1", [1, 0])]);
    a.save();
    expect(new VectorStore(file, "model-a").size()).toBe(1);
  });

  it("discards records when the embed model changed (forces a clean rebuild)", () => {
    const a = new VectorStore(file, "model-a");
    a.upsertBySource([rec("1", [1, 0])]);
    a.save();
    expect(new VectorStore(file, "model-b").size()).toBe(0);
  });
});

describe("cosine", () => {
  it("returns 0 for mismatched vector lengths instead of truncating", () => {
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
  });
  it("scores equal-length vectors normally", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
