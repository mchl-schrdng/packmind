import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { isEligiblePath, fingerprint } from "../src/change/eligible.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

const cfg = DEFAULT_CONFIG;

describe("isEligiblePath", () => {
  const root = "/proj";
  it("accepts an ordinary source path", () => {
    expect(isEligiblePath(root, "src/a.ts", cfg)).toBe(true);
  });
  it("rejects .packmind and .git paths", () => {
    expect(isEligiblePath(root, ".packmind/state/x.json", cfg)).toBe(false);
    expect(isEligiblePath(root, ".git/config", cfg)).toBe(false);
  });
  it("rejects excluded directories", () => {
    expect(isEligiblePath(root, "node_modules/x/index.js", cfg)).toBe(false);
  });
  it("rejects binary and secret files", () => {
    expect(isEligiblePath(root, "assets/logo.png", cfg)).toBe(false);
    expect(isEligiblePath(root, "deep/dir/id_rsa", cfg)).toBe(false);
    expect(isEligiblePath(root, ".env", cfg)).toBe(false);
  });
  it("rejects a path that escapes the root", () => {
    expect(isEligiblePath(root, "../outside.ts", cfg)).toBe(false);
  });
  it("a deleted (absent) eligible path is still eligible (for a delete record)", () => {
    // /proj/src/gone.ts does not exist; still eligible by name.
    expect(isEligiblePath(root, "src/gone.ts", cfg)).toBe(true);
  });
  it("rejects an oversized file on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-elig-"));
    fs.writeFileSync(path.join(dir, "big.ts"), Buffer.alloc(1_048_577, 0x61));
    expect(isEligiblePath(dir, "big.ts", cfg)).toBe(false);
  });
});

describe("fingerprint", () => {
  it("is stable for identical content and differs for different content", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fp-"));
    fs.writeFileSync(path.join(dir, "a"), "hello");
    fs.writeFileSync(path.join(dir, "b"), "hello");
    fs.writeFileSync(path.join(dir, "c"), "world");
    expect(fingerprint(path.join(dir, "a"))).toBe(fingerprint(path.join(dir, "b")));
    expect(fingerprint(path.join(dir, "a"))).not.toBe(fingerprint(path.join(dir, "c")));
  });
  it("returns null for a missing file", () => {
    expect(fingerprint("/no/such/file")).toBeNull();
  });
});
