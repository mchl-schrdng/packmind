import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { walkProject } from "../src/state/walk.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-walk-"));
  return dir;
}

function write(root: string, rel: string, content = "x"): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function walked(root: string): string[] {
  return walkProject(root, DEFAULT_CONFIG)
    .map((f) => f.rel)
    .sort();
}

describe("[P1] walkProject honors nested .gitignore (privacy leak)", () => {
  it("a nested sub/.gitignore excludes files in its own subtree", () => {
    const root = tmpProject();
    write(root, "sub/.gitignore", "private.txt\n");
    write(root, "sub/private.txt", "SECRET");
    write(root, "sub/public.ts", "export const ok = 1;");

    const files = walked(root);
    expect(files).not.toContain("sub/private.txt"); // nested rule respected
    expect(files).toContain("sub/public.ts"); // sibling still mapped
  });

  it("still honors the root .gitignore", () => {
    const root = tmpProject();
    write(root, ".gitignore", "ignored.ts\n");
    write(root, "ignored.ts", "x");
    write(root, "kept.ts", "x");

    const files = walked(root);
    expect(files).not.toContain("ignored.ts");
    expect(files).toContain("kept.ts");
  });

  it("a nested .gitignore does not leak its rules to sibling subtrees", () => {
    const root = tmpProject();
    write(root, "a/.gitignore", "data.json\n");
    write(root, "a/data.json", "x");
    write(root, "b/data.json", "x"); // different subtree, must survive

    const files = walked(root);
    expect(files).not.toContain("a/data.json");
    expect(files).toContain("b/data.json");
  });
});
