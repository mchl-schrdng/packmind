import { describe, it, expect } from "vitest";
import { reconcileGit, type GitBaseline, type GitCurrent } from "../src/change/reconcile.js";
import type { PorcelainStatus } from "../src/change/git.js";

const status = (
  changed: Array<[string, string]>,
  renames: Array<{ from: string; to: string }> = [],
): PorcelainStatus => ({ changed: changed.map(([path, xy]) => ({ path, xy })), renames });

const base = (s: PorcelainStatus, hashes: Record<string, string> = {}): GitBaseline => ({ status: s, hashes });
const cur = (s: PorcelainStatus, hashes: Record<string, string> = {}): GitCurrent => ({ status: s, hashes });

const kinds = (b: GitBaseline, c: GitCurrent) =>
  reconcileGit(b, c).map((x) => `${x.kind} ${x.previousPath ? x.previousPath + "->" : ""}${x.path}`);

describe("reconcileGit (porcelain status vs session baseline)", () => {
  it("a clean file modified during the session is a modify", () => {
    expect(kinds(base(status([])), cur(status([["src/a.ts", ".M"]])))).toEqual(["modify src/a.ts"]);
  });

  it("a new untracked file is an add", () => {
    expect(kinds(base(status([])), cur(status([["src/new.ts", "??"]])))).toEqual(["add src/new.ts"]);
  });

  it("a clean file deleted during the session is a delete", () => {
    expect(kinds(base(status([])), cur(status([["src/gone.ts", ".D"]])))).toEqual(["delete src/gone.ts"]);
  });

  it("a file already dirty at baseline, unchanged since, is NOT a session change", () => {
    const b = base(status([["src/pre.ts", ".M"]]), { "src/pre.ts": "h1" });
    const c = cur(status([["src/pre.ts", ".M"]]), { "src/pre.ts": "h1" });
    expect(kinds(b, c)).toEqual([]);
  });

  it("a file dirty at baseline that changed further is a modify", () => {
    const b = base(status([["src/pre.ts", ".M"]]), { "src/pre.ts": "h1" });
    const c = cur(status([["src/pre.ts", ".M"]]), { "src/pre.ts": "h2" });
    expect(kinds(b, c)).toEqual(["modify src/pre.ts"]);
  });

  it("a file present+dirty at baseline that is now gone is a delete", () => {
    const b = base(status([["src/pre.ts", "??"]]), { "src/pre.ts": "h1" });
    const c = cur(status([["src/pre.ts", ".D"]]), {}); // no current hash: gone
    expect(kinds(b, c)).toEqual(["delete src/pre.ts"]);
  });

  it("a new git rename is a rename; a pre-existing rename is not", () => {
    const b = base(status([], [{ from: "old.ts", to: "mid.ts" }]));
    const c = cur(status([], [
      { from: "old.ts", to: "mid.ts" }, // pre-existing (also in baseline)
      { from: "a.ts", to: "b.ts" }, // new this session
    ]));
    expect(kinds(b, c)).toEqual(["rename a.ts->b.ts"]);
  });

  it("results are sorted by path", () => {
    expect(kinds(base(status([])), cur(status([["z.ts", "??"], ["a.ts", "??"]])))).toEqual(["add a.ts", "add z.ts"]);
  });
});
