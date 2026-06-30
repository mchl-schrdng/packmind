import { describe, it, expect, beforeEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSnapshot, listSnapshots, restoreSnapshot, pruneSnapshots } from "../src/state/snapshot.js";
import { consolidateJournal } from "../src/state/maintain.js";
import { computeInsights } from "../src/cost/insights.js";
import { commitSession, emptyLedger, readLedger } from "../src/cost/ledger.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import { brain, emptySession } from "../src/state/files.js";

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-feat-"));
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "recall"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG, null, 2));
  fs.writeFileSync(b.knowledge, "# Knowledge\n");
  fs.writeFileSync(b.journal, "# Journal\n\n> log\n");
  fs.writeFileSync(b.map, "# Project Map\n\n## src/\n\n- `a.ts` · ~100 tok · $0.0015 — A\n");
  return dir;
}

describe("snapshots (backup/restore)", () => {
  // Snapshots write under ~/.packmind/backups keyed by basename; use a unique
  // project name so parallel runs don't collide.
  let dir: string;
  beforeEach(() => {
    dir = makeProject();
  });

  it("creates, lists and restores a snapshot", () => {
    createSnapshot(dir, "snap-a");
    expect(listSnapshots(dir)).toContain("snap-a");

    // mutate, then restore
    fs.writeFileSync(brain(dir).knowledge, "# Knowledge\nCHANGED\n");
    expect(restoreSnapshot(dir, "snap-a")).toBe(true);
    expect(fs.readFileSync(brain(dir).knowledge, "utf8")).not.toContain("CHANGED");
  });

  it("skips the regenerable vector index", () => {
    fs.writeFileSync(path.join(brain(dir).recallDir, "vectors.json"), "{}");
    const snap = createSnapshot(dir, "snap-b");
    expect(fs.existsSync(path.join(snap, "recall", "vectors.json"))).toBe(false);
  });

  it("prunes to the most recent N", () => {
    for (const s of ["s1", "s2", "s3", "s4"]) createSnapshot(dir, s);
    const removed = pruneSnapshots(dir, 2);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(listSnapshots(dir).length).toBeLessThanOrEqual(2);
  });
});

describe("journal consolidation", () => {
  it("archives old lines once over the threshold and is non-destructive", () => {
    const dir = makeProject();
    const b = brain(dir);
    const big = ["# Journal", "", "> log", ...Array.from({ length: 2000 }, (_, i) => `| line ${i} |`)].join("\n");
    fs.writeFileSync(b.journal, big);
    const archived = consolidateJournal(dir);
    expect(archived).toBeGreaterThan(0);
    const kept = fs.readFileSync(b.journal, "utf8");
    expect(kept.split("\n").length).toBeLessThan(2000);
    const arch = fs.readFileSync(path.join(b.dir, "journal.archive.md"), "utf8");
    expect(arch).toContain("line 0"); // oldest preserved in the archive
    expect(consolidateJournal(dir)).toBe(0); // idempotent under threshold
  });
});

describe("insights", () => {
  it("computes savings, coverage and flags from state", () => {
    const dir = makeProject();
    const b = brain(dir);
    fs.writeFileSync(
      b.usage,
      JSON.stringify({
        version: 1,
        model: "claude-opus-4-8",
        createdAt: "x",
        totals: { inputTokens: 1000, outputTokens: 500, inputCost: 0.01, outputCost: 0.02, reads: 20, writes: 5, sessions: 3, dedupedReads: 4, mapHits: 6 },
        sessions: [],
      }),
    );
    const r = computeInsights(dir, DEFAULT_CONFIG);
    expect(r.totalCost).toBeCloseTo(0.03, 6);
    expect(r.reReadsAvoided).toBe(4);
    expect(r.mapCoverage).toBeCloseTo(6 / 20, 6);
    expect(r.estTokensSaved).toBeGreaterThan(0);
    // coverage 30% < 60% with 20 reads → a low-coverage warning
    expect(r.flags.some((f) => f.title === "Low map coverage")).toBe(true);
  });
});

describe("usage ledger", () => {
  it("records dedupedReads and mapHits on each committed session", () => {
    const dir = makeProject();
    const b = brain(dir);
    fs.writeFileSync(b.usage, JSON.stringify(emptyLedger("claude-opus-4-8")));

    const s = emptySession("s-test");
    s.inputTokens = 1200;
    s.outputTokens = 300;
    s.dedupedReads = 5;
    s.mapHits = 8;
    s.writes.push({ file: "a.ts", action: "edit", tokens: 50, at: "x" });
    commitSession(dir, "claude-opus-4-8", s);

    const ledger = readLedger(dir, "claude-opus-4-8");
    expect(ledger.sessions).toHaveLength(1);
    // Per-session savings counters surface to the dashboard's savings chart.
    expect(ledger.sessions[0].dedupedReads).toBe(5);
    expect(ledger.sessions[0].mapHits).toBe(8);
    // And they still aggregate into lifetime totals.
    expect(ledger.totals.dedupedReads).toBe(5);
    expect(ledger.totals.mapHits).toBe(8);
  });
});
