import { describe, it, expect } from "vitest";
import { parsePorcelainV2 } from "../src/change/git.js";

// Build a NUL-delimited porcelain v2 payload from record strings.
const z = (...records: string[]) => records.join("\0") + "\0";

describe("parsePorcelainV2", () => {
  it("parses ordinary changed (type 1) entries and keeps their XY code", () => {
    const out = parsePorcelainV2(z("1 .M N... 100644 100644 100644 aaa bbb src/a.ts"));
    expect(out.changed).toEqual([{ path: "src/a.ts", xy: ".M" }]);
    expect(out.renames).toEqual([]);
  });

  it("parses untracked (type ?) entries as added-candidates", () => {
    const out = parsePorcelainV2(z("? src/new.ts"));
    expect(out.changed).toEqual([{ path: "src/new.ts", xy: "??" }]);
  });

  it("parses a rename (type 2): the original path is the following NUL field", () => {
    // "2 R. ... R100 <newpath>\0<origpath>"
    const out = parsePorcelainV2(z("2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts", "src/old.ts"));
    expect(out.renames).toEqual([{ from: "src/old.ts", to: "src/new.ts" }]);
    expect(out.changed).toEqual([]);
  });

  it("handles paths containing spaces (NUL-delimited, unquoted)", () => {
    const out = parsePorcelainV2(z("1 .M N... 100644 100644 100644 aaa bbb my dir/a b.ts"));
    expect(out.changed).toEqual([{ path: "my dir/a b.ts", xy: ".M" }]);
  });

  it("skips ignored (type !) entries and ignores empty trailing fields", () => {
    const out = parsePorcelainV2(z("! node_modules/x.js", "1 .D N... 100644 100644 000000 aaa bbb gone.ts"));
    expect(out.changed).toEqual([{ path: "gone.ts", xy: ".D" }]);
  });
});
