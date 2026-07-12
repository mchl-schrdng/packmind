import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { brain } from "../src/state/files.js";
import { parseMap } from "../src/state/formats.js";
import { upsertMapEntry, removeMapEntry } from "../src/state/map-mutations.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-mapmut-"));
  fs.mkdirSync(brain(dir).dir, { recursive: true });
  return dir;
}
const entries = (dir: string) => {
  const out: string[] = [];
  for (const [section, list] of parseMap(fs.readFileSync(brain(dir).map, "utf8"))) {
    for (const e of list) out.push(section + e.file);
  }
  return out.sort();
};

describe("upsertMapEntry", () => {
  it("adds an entry with tokens and cost, then updates it in place", () => {
    const dir = project();
    upsertMapEntry(dir, "src/a.ts", "// alpha module\nexport const a = 1;\n", DEFAULT_CONFIG);
    expect(entries(dir)).toEqual(["src/a.ts"]);
    let map = parseMap(fs.readFileSync(brain(dir).map, "utf8"));
    const first = map.get("src/")![0];
    expect(first.tokens).toBeGreaterThan(0);

    upsertMapEntry(dir, "src/a.ts", "// alpha module changed with more content here\n".repeat(4), DEFAULT_CONFIG);
    map = parseMap(fs.readFileSync(brain(dir).map, "utf8"));
    expect(map.get("src/")!).toHaveLength(1); // updated in place, not duplicated
    expect(map.get("src/")![0].tokens).toBeGreaterThan(first.tokens);
  });
});

describe("removeMapEntry", () => {
  it("removes an entry and drops the now-empty section", () => {
    const dir = project();
    upsertMapEntry(dir, "src/a.ts", "const a = 1;", DEFAULT_CONFIG);
    upsertMapEntry(dir, "src/b.ts", "const b = 2;", DEFAULT_CONFIG);
    expect(entries(dir)).toEqual(["src/a.ts", "src/b.ts"]);

    removeMapEntry(dir, "src/a.ts");
    expect(entries(dir)).toEqual(["src/b.ts"]);

    removeMapEntry(dir, "src/b.ts");
    expect(entries(dir)).toEqual([]); // section gone too
  });

  it("a rename is remove-old + upsert-new", () => {
    const dir = project();
    upsertMapEntry(dir, "src/old.ts", "const x = 1;", DEFAULT_CONFIG);
    removeMapEntry(dir, "src/old.ts");
    upsertMapEntry(dir, "src/new.ts", "const x = 1;", DEFAULT_CONFIG);
    expect(entries(dir)).toEqual(["src/new.ts"]);
  });
});
