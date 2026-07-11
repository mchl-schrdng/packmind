import { describe, it, expect } from "vitest";
import { emptyChangeSet, recordCandidate, reconcileInto } from "../src/change/store.js";

const cs = () => emptyChangeSet({ incarnationId: "inc1", root: "/p", baselineCreatedAt: "t0" });

describe("recordCandidate", () => {
  it("adds a new record then merges a later event (kind + source)", () => {
    const c = cs();
    recordCandidate(c, { path: "a.ts", kind: "add" }, "post-tool", "t1");
    expect(c.changes["a.ts"].kind).toBe("add");
    expect(c.changes["a.ts"].sources).toEqual(["post-tool"]);

    recordCandidate(c, { path: "a.ts", kind: "modify" }, "file-changed", "t2", ["Bash"]);
    expect(c.changes["a.ts"].kind).toBe("modify");
    expect(c.changes["a.ts"].firstSeenAt).toBe("t1"); // preserved
    expect(c.changes["a.ts"].lastSeenAt).toBe("t2");
    expect(c.changes["a.ts"].sources).toEqual(["post-tool", "file-changed"]);
    expect(c.changes["a.ts"].suspectedTools).toEqual(["Bash"]);
  });
});

describe("reconcileInto", () => {
  it("adds present paths, preserves firstSeenAt, and drops reverted paths", () => {
    const c = cs();
    recordCandidate(c, { path: "a.ts", kind: "modify" }, "post-tool", "t1");
    recordCandidate(c, { path: "reverted.ts", kind: "modify" }, "post-tool", "t1");

    // Reconcile says: a.ts still modified, b.ts newly added, reverted.ts gone.
    reconcileInto(c, [{ path: "a.ts", kind: "modify" }, { path: "b.ts", kind: "add" }], "t3");

    expect(Object.keys(c.changes).sort()).toEqual(["a.ts", "b.ts"]);
    expect(c.changes["a.ts"].firstSeenAt).toBe("t1"); // preserved across reconcile
    expect(c.changes["a.ts"].sources).toContain("reconcile");
    expect(c.changes["b.ts"].kind).toBe("add");
    expect(c.changes["reverted.ts"]).toBeUndefined(); // dropped
    expect(c.lastReconciledAt).toBe("t3");
    expect(c.reconcileRequested).toBe(false);
  });
});
