import { describe, it, expect } from "vitest";
import { parseMap, serializeMap, parseNeverDo } from "../src/state/formats.js";

const LF = `# Project Map

_Maintained by PackMind · 2 files · updated x_

## src/

- \`index.ts\` · ~180 tok · $0.0027 — Main entry
- \`util.ts\` · ~90 tok — Helpers
`;

describe("map format (CRLF-safe)", () => {
  it("parses LF", () => {
    const m = parseMap(LF);
    expect(m.get("src/")).toHaveLength(2);
    expect(m.get("src/")![0]).toMatchObject({ file: "index.ts", tokens: 180, cost: 0.0027, description: "Main entry" });
  });

  it("parses CRLF identically (no wipe)", () => {
    const m = parseMap(LF.replace(/\n/g, "\r\n"));
    expect(m.get("src/")).toHaveLength(2);
    expect(m.get("src/")![1]).toMatchObject({ file: "util.ts", tokens: 90 });
  });

  it("round-trips through serialize", () => {
    const m = parseMap(LF.replace(/\n/g, "\r\n"));
    const out = serializeMap(m, { fileCount: 2, updated: "y" });
    expect(parseMap(out).get("src/")).toHaveLength(2);
  });
});

describe("parseNeverDo", () => {
  it("reads only the Never Do section, CRLF-safe", () => {
    const k = "## Never Do\r\n\r\n- Never use `var`\r\n- Avoid default exports\r\n\r\n## Notes\r\n- something\r\n";
    expect(parseNeverDo(k)).toEqual(["Never use `var`", "Avoid default exports"]);
  });
});
