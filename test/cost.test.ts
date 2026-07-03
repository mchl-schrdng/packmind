import { describe, it, expect } from "vitest";
import { estimateTokens } from "../src/cost/estimator.js";
import { inputCost, outputCost, rateFor } from "../src/cost/pricing.js";

describe("token estimator", () => {
  it("returns 0 for empty and positive for content", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world this is a sentence")).toBeGreaterThan(0);
  });
  it("treats code extensions with a denser ratio", () => {
    const text = "const a=1;const b=2;const c=3;".repeat(10);
    expect(estimateTokens(text, "x.ts")).toBeGreaterThan(estimateTokens(text, "x.md"));
  });
});

describe("pricing", () => {
  it("maps model families to rates", () => {
    expect(rateFor("claude-opus-4-8").outputPerMTok).toBe(25);
    expect(rateFor("some-sonnet-thing").inputPerMTok).toBe(3);
    expect(rateFor("unknown").inputPerMTok).toBe(5); // falls back to opus tier
  });
  it("computes dollar cost from tokens", () => {
    expect(inputCost("claude-opus-4-8", 1_000_000)).toBeCloseTo(5, 6);
    expect(outputCost("claude-opus-4-8", 1_000_000)).toBeCloseTo(25, 6);
    expect(inputCost("claude-haiku-4-5", 500_000)).toBeCloseTo(0.5, 6);
  });
});
