import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { store, retrieve, compact } from "../src/compress/store.js";

describe("compress store", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-compress-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("round-trips: retrieve returns the exact original", () => {
    const original = "line one\nline two\n".repeat(500);
    const { hash } = store(root, original);
    expect(retrieve(root, hash)).toBe(original);
  });

  it("is content-addressed: identical content yields one hash and one blob", () => {
    const a = store(root, "same content").hash;
    const b = store(root, "same content").hash;
    expect(a).toBe(b);
    const index = JSON.parse(fs.readFileSync(path.join(root, ".packmind", "compress", "index.json"), "utf8"));
    expect(index.filter((m: { hash: string }) => m.hash === a)).toHaveLength(1);
  });

  it("leaves small content uncompacted", () => {
    const small = "just a short note\nnothing to shrink";
    expect(compact(small, "deadbeef")).toBe(small);
    expect(store(root, small).preview).toBe(small);
  });

  it("compacts large content but keeps head, tail, signal lines, and a retrieve marker", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `log line ${i} with some padding text here`);
    lines[120] = "ERROR: boom happened at line 120";
    const original = lines.join("\n");
    const { hash, preview } = store(root, original);
    expect(preview.length).toBeLessThan(original.length);
    expect(preview).toContain('retrieve("');
    expect(preview).toContain("matched lines:");
    expect(preview).toContain("ERROR: boom happened");
    expect(preview).toContain("log line 0 ");   // head kept
    expect(preview).toContain("log line 199 ");  // tail kept
    expect(retrieve(root, hash)).toBe(original);  // full original still recoverable
  });

  it("prunes the oldest blobs past the cap", () => {
    const hashes: string[] = [];
    for (let i = 0; i < 55; i++) hashes.push(store(root, `distinct blob number ${i}`).hash);
    expect(retrieve(root, hashes[54])).not.toBeNull();      // newest kept
    expect(retrieve(root, hashes[0])).toBeNull();           // oldest evicted
    const index = JSON.parse(fs.readFileSync(path.join(root, ".packmind", "compress", "index.json"), "utf8"));
    expect(index.length).toBeLessThanOrEqual(50);
  });

  it("rejects a path-traversal hash", () => {
    expect(retrieve(root, "../../../../etc/passwd")).toBeNull();
  });

  it("keeps a blob larger than the total cap (never evicts what was just stored)", () => {
    const big = "x".repeat(6 * 1024 * 1024); // > 5 MB cap
    const { hash } = store(root, big);
    expect(retrieve(root, hash)).toBe(big);
  });

  it("never returns a preview longer than the original", () => {
    // Mostly-signal content: every middle line matches error/warn.
    const lines = Array.from({ length: 26 }, (_, i) => `ERROR at position ${i} `.repeat(8));
    const original = lines.join("\n");
    expect(original.length).toBeGreaterThan(4096);
    expect(store(root, original).preview.length).toBeLessThanOrEqual(original.length);
  });
});
