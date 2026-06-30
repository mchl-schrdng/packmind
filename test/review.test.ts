import { describe, it, expect } from "vitest";
import { reviewPayload, gitDiff } from "../src/state/review.js";

describe("reviewPayload", () => {
  it("messages when the diff is empty or whitespace", () => {
    expect(reviewPayload("")).toMatch(/Nothing to review/);
    expect(reviewPayload("   \n")).toMatch(/Nothing to review/);
  });

  it("wraps a real diff with the ladder and a delete-list instruction", () => {
    const out = reviewPayload("diff --git a/x b/x\n+new line");
    expect(out).toMatch(/delete-list/);
    expect(out).toMatch(/Decision ladder/);
    expect(out).toContain("+new line");
  });
});

describe("gitDiff", () => {
  it("returns '' for a non-git directory instead of throwing", () => {
    expect(gitDiff("/nonexistent-path-xyz-123")).toBe("");
  });
});
