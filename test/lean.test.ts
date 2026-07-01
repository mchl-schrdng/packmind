import { describe, it, expect } from "vitest";
import { newSession, leanNudge } from "../src/hooks/runtime.js";
import { DEFAULT_CONFIG, deepMerge, type Config } from "../src/state/schema.js";

/**
 * Lean mode: a reuse-first decision-ladder reminder injected before writes. The
 * nudge must respect the configured mode and, in "lite", fire at most once per
 * session (same latch discipline as the Stop-hook reminder).
 */
describe("leanNudge", () => {
  it("is silent when mode is off or unknown", () => {
    expect(leanNudge("off", newSession("s"))).toBeNull();
    expect(leanNudge("bogus", newSession("s"))).toBeNull();
  });

  it("fires once per session in lite, then latches", () => {
    const s = newSession("s");
    const first = leanNudge("lite", s);
    expect(first).toMatch(/Lean check/);
    expect(s.notifiedLean).toBe(true);
    expect(leanNudge("lite", s)).toBeNull();
  });

  it("fires on every write in full mode (no latch)", () => {
    const s = newSession("s");
    expect(leanNudge("full", s)).toMatch(/Lean check/);
    expect(leanNudge("full", s)).toMatch(/Lean check/);
    expect(s.notifiedLean).toBeUndefined();
  });
});

describe("guard.lean config", () => {
  it("defaults to lite", () => {
    expect(DEFAULT_CONFIG.guard.lean.mode).toBe("lite");
  });

  it("backfills guard.lean for a legacy config that predates it", () => {
    const legacy = { guard: { blockSecrets: true } };
    const merged = deepMerge<Config>(DEFAULT_CONFIG, legacy);
    expect(merged.guard.lean.mode).toBe("lite"); // backfilled from defaults
    expect(merged.guard.blockSecrets).toBe(true); // user value preserved
  });
});
