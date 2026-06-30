import { describe, it, expect } from "vitest";
import { newSession, computeStopReminders, type Session } from "../src/hooks/runtime.js";

/**
 * Regression: the Stop hook must nudge at most once per session. Before the
 * latch, a still-true condition (writes >= 3) re-emitted every turn, and since
 * emitting context from Stop re-invokes the agent, that looped forever.
 */
describe("computeStopReminders", () => {
  const withWrites = (n: number): Session => {
    const s = newSession("s-test");
    s.writes = Array.from({ length: n }, (_, i) => ({ file: `f${i}.ts`, action: "Write", tokens: 1, at: "t" }));
    return s;
  };

  it("emits the 'files changed' nudge once, then latches", () => {
    const s = withWrites(3);
    const first = computeStopReminders(s);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/record durable/);
    expect(s.notifiedWrites).toBe(true);
    // Condition is still true, but the latch suppresses the repeat.
    expect(computeStopReminders(s)).toEqual([]);
  });

  it("does not nudge below the write threshold", () => {
    expect(computeStopReminders(withWrites(2))).toEqual([]);
  });

  it("emits the heavy-edit nudge once per file", () => {
    const s = withWrites(1);
    s.editCounts = { "a.ts": 4, "b.ts": 2 };
    const first = computeStopReminders(s);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/`a\.ts`/);
    expect(first[0]).not.toMatch(/`b\.ts`/);
    expect(s.notifiedEdits).toEqual(["a.ts"]);
    expect(computeStopReminders(s)).toEqual([]);
  });

  it("nudges again only for a newly hot file", () => {
    const s = withWrites(1);
    s.editCounts = { "a.ts": 4 };
    computeStopReminders(s);
    s.editCounts["c.ts"] = 5;
    const next = computeStopReminders(s);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatch(/`c\.ts`/);
    expect(next[0]).not.toMatch(/`a\.ts`/);
  });
});
