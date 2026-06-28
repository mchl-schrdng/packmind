import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { cosine, VectorStore } from "../src/recall/store.js";
import { chunkText } from "../src/recall/chunker.js";
import { buildIndex, recall } from "../src/recall/indexer.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import type { Embedder } from "../src/recall/embedder.js";

/** Deterministic bag-of-words embedder so recall is testable without a model. */
class StubEmbedder implements Embedder {
  private vocab = ["auth", "token", "database", "cache", "render", "error", "config", "user"];
  dimensions() {
    return this.vocab.length;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const lower = t.toLowerCase();
      const v = this.vocab.map((w) => (lower.includes(w) ? 1 : 0));
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

describe("cosine + store", () => {
  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("upsertBySource replaces prior records for a source", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-store-")), "v.json");
    const store = new VectorStore(file);
    store.upsertBySource([{ id: "a#0", source: "a", kind: "code", text: "x", vector: [1, 0] }]);
    store.upsertBySource([{ id: "a#0", source: "a", kind: "code", text: "y", vector: [0, 1] }]);
    expect(store.size()).toBe(1);
  });
});

describe("chunker", () => {
  it("splits large text and keeps small text whole", () => {
    expect(chunkText("short", "s", "code")).toHaveLength(1);
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    expect(chunkText(big, "s", "code", 200).length).toBeGreaterThan(1);
  });
});

describe("index + recall (stub embedder)", () => {
  it("indexes a project and ranks the relevant file first", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-recall-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".packmind", "recall"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "auth.ts"), "handle auth token for user login");
    fs.writeFileSync(path.join(dir, "src", "render.ts"), "render the cache view");

    const config = { ...DEFAULT_CONFIG, map: { ...DEFAULT_CONFIG.map, respectGitignore: false } };
    const embedder = new StubEmbedder();
    const count = await buildIndex(dir, config, embedder);
    expect(count).toBeGreaterThan(0);

    const hits = await recall(dir, config, embedder, "auth token");
    expect(hits[0].source).toContain("auth.ts");
  });
});
