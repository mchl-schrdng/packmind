import { describe, it, expect } from "vitest";
import { parseNeverDo, lines } from "../src/state/formats.js";

describe("lines", () => {
  it("splits LF and CRLF identically", () => {
    expect(lines("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(lines("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("parseNeverDo", () => {
  it("reads only the Never Do section, CRLF-safe", () => {
    const k = "## Never Do\r\n\r\n- Never use `var`\r\n- Avoid default exports\r\n\r\n## Notes\r\n- something\r\n";
    expect(parseNeverDo(k)).toEqual(["Never use `var`", "Avoid default exports"]);
  });

  it("strips a leading [date] marker and tolerates * bullets", () => {
    const k = "## Never Do\n- [2026-07-13] no em dashes\n* no console.log\n";
    expect(parseNeverDo(k)).toEqual(["no em dashes", "no console.log"]);
  });

  it("returns empty when the section is absent", () => {
    expect(parseNeverDo("## Notes\n- a\n")).toEqual([]);
  });
});
