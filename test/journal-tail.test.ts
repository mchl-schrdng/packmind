import { describe, it, expect } from "vitest";
import { journalTail } from "../src/dashboard/server.js";

/**
 * The dashboard's client parser keys sessions on `## ` headers. A naive
 * last-N-lines slice can scroll a long active session's header out of the
 * window, leaving orphan rows the parser drops — rendering the tab "empty"
 * despite real activity. journalTail must always return complete sessions.
 */
describe("journalTail", () => {
  it("returns the whole journal when under the line cap", () => {
    const text = "## s1 — t\n| Time |\n| 10:00 | Write | `a.ts` | ~5 |";
    expect(journalTail(text, 200)).toBe(text);
  });

  it("backs up to the session header rather than orphaning rows", () => {
    // 6 lines, cap 5: a naive slice(-5) starts at "| Time |" (no header).
    const text = ["## s1 — t", "| Time |", "| a |", "| b |", "| c |", "| d |"].join("\n");
    const out = journalTail(text, 5);
    expect(out.startsWith("## s1 — t")).toBe(true);
    expect(out).toBe(text); // backed all the way up to the only header
  });

  it("keeps the leading session whole even when it exceeds the cap", () => {
    const long = ["## s1 — t", ...Array.from({ length: 50 }, (_, i) => `| ${i} |`)].join("\n");
    const out = journalTail(long, 10);
    expect(out.startsWith("## s1 — t")).toBe(true);
    expect(out.split("\n")).toHaveLength(51); // not truncated mid-session
  });

  it("drops a fully-elapsed older session but never half of a kept one", () => {
    const s1 = ["## s1 — t1", "| a |", "| b |"];
    const s2 = ["## s2 — t2", "| c |", "| d |", "| e |"];
    const out = journalTail([...s1, ...s2].join("\n"), 4);
    expect(out.startsWith("## s2 — t2")).toBe(true); // s2 header preserved
    expect(out).not.toContain("## s1"); // older session dropped cleanly
  });

  it("returns from the top when there is no session header", () => {
    const text = "# Journal\n\n> Chronological action log.";
    expect(journalTail(text, 2)).toBe(text);
  });
});
