import { describe, it, expect } from "vitest";
import { computeNetChanges } from "../src/change/reconcile.js";
import type { Snapshot } from "../src/change/types.js";

const snap = (hashes: Record<string, string>, renames?: Snapshot["renames"]): Snapshot => ({ hashes, renames });
const kinds = (baseline: Snapshot, current: Snapshot) =>
  computeNetChanges(baseline, current).map((c) => `${c.kind} ${c.previousPath ? c.previousPath + "->" : ""}${c.path}`);

describe("computeNetChanges (net semantics from baseline vs current endpoints)", () => {
  it("modify: a file present in both with a different fingerprint", () => {
    expect(kinds(snap({ "a.ts": "h1" }), snap({ "a.ts": "h2" }))).toEqual(["modify a.ts"]);
  });

  it("add: absent at baseline, present now", () => {
    expect(kinds(snap({}), snap({ "a.ts": "h1" }))).toEqual(["add a.ts"]);
  });

  it("add then delete nets to no change (absent at both endpoints)", () => {
    expect(kinds(snap({}), snap({}))).toEqual([]);
  });

  it("delete then recreate identical nets to no change", () => {
    expect(kinds(snap({ "a.ts": "h1" }), snap({ "a.ts": "h1" }))).toEqual([]);
  });

  it("delete then recreate different nets to modify", () => {
    expect(kinds(snap({ "a.ts": "h1" }), snap({ "a.ts": "h9" }))).toEqual(["modify a.ts"]);
  });

  it("delete: present at baseline, absent now", () => {
    expect(kinds(snap({ "a.ts": "h1" }), snap({}))).toEqual(["delete a.ts"]);
  });

  it("git-confirmed rename: from in baseline, to now, reported as rename", () => {
    expect(kinds(snap({ "old.ts": "h1" }), snap({ "new.ts": "h1" }, [{ from: "old.ts", to: "new.ts" }]))).toEqual([
      "rename old.ts->new.ts",
    ]);
  });

  it("rename plus modify of the destination still nets to a rename", () => {
    expect(kinds(snap({ "old.ts": "h1" }), snap({ "new.ts": "h2" }, [{ from: "old.ts", to: "new.ts" }]))).toEqual([
      "rename old.ts->new.ts",
    ]);
  });

  it("uncertain rename (from missing from baseline) degrades to add of the destination", () => {
    expect(kinds(snap({}), snap({ "new.ts": "h1" }, [{ from: "old.ts", to: "new.ts" }]))).toEqual(["add new.ts"]);
  });

  it("pre-existing dirty file, unchanged since baseline, is not a session change", () => {
    // Baseline already captured the dirty content; unchanged -> nothing.
    expect(kinds(snap({ "dirty.ts": "d1", "clean.ts": "c1" }), snap({ "dirty.ts": "d1", "clean.ts": "c1" }))).toEqual([]);
  });

  it("results are sorted by path for stable output", () => {
    expect(kinds(snap({}), snap({ "b.ts": "h", "a.ts": "h" }))).toEqual(["add a.ts", "add b.ts"]);
  });
});
