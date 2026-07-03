import { describe, it, expect } from "vitest";
import * as canon from "../src/state/formats.js";
import * as est from "../src/cost/estimator.js";
import * as secrets from "../src/guard/secrets.js";
import * as guard from "../src/guard/path-guard.js";
import * as policy from "../src/guard/policy.js";
import * as pricing from "../src/cost/pricing.js";
import * as ledger from "../src/cost/ledger.js";
import * as rt from "../src/hooks/runtime.js";

/**
 * The zero-dependency hook runtime mirrors several canonical modules. These
 * checks guarantee the mirrors never drift from their source of truth.
 */
describe("hook runtime parity", () => {
  const mapFixtures = [
    "## src/\n\n- `a.ts` · ~10 tok — One\n- `b.ts` · ~20 tok\n",
    "## src/\r\n\r\n- `a.ts` · ~10 tok — One\r\n- `b.ts` · ~20 tok\r\n",
  ];
  for (const [i, fx] of mapFixtures.entries()) {
    it(`parseMap matches (fixture ${i})`, () => {
      expect(JSON.stringify([...rt.parseMap(fx)])).toEqual(JSON.stringify([...canon.parseMap(fx)]));
    });
  }

  it("serializeMap matches", () => {
    const m = canon.parseMap(mapFixtures[0]);
    const meta = { fileCount: 2, updated: "z" };
    expect(rt.serializeMap(rt.parseMap(mapFixtures[0]), meta)).toEqual(canon.serializeMap(m, meta));
  });

  it("parseNeverDo matches", () => {
    const k = "## Never Do\r\n- one\r\n- two\r\n";
    expect(rt.parseNeverDo(k)).toEqual(canon.parseNeverDo(k));
  });

  it("estimateTokens matches", () => {
    for (const [t, h] of [["const x = 1;", "a.ts"], ["Some prose here.", "a.md"], ["", "x"]] as const) {
      expect(rt.estimateTokens(t, h)).toEqual(est.estimateTokens(t, h));
    }
  });

  it("looksSecret matches", () => {
    for (const f of ["id_rsa", "a.pem", "index.ts", ".env.local"]) {
      expect(rt.looksSecret(f)).toEqual(secrets.looksSecret(f));
    }
  });

  it("samePath matches", () => {
    const root = "/p";
    expect(rt.samePath(root, "src/a.ts", "src/a.ts")).toEqual(guard.samePath(root, "src/a.ts", "src/a.ts"));
    expect(rt.samePath(root, "util/a.ts", "src/util/a.ts")).toEqual(guard.samePath(root, "util/a.ts", "src/util/a.ts"));
  });

  it("evaluateWrite matches for a secret-block case", () => {
    const input = { relPath: "id_rsa", content: "", blockSecrets: true, extraSecretGlobs: [] };
    const a = rt.evaluateWrite([], input);
    const b = policy.evaluateWrite({ version: 1, rules: [] }, input);
    expect(a.block).toEqual(b.block);
  });

  it("evaluateWrite matches for a path-shaped extraSecretGlobs case", () => {
    // `config/**` only matches against the relative PATH, not the basename, so
    // this guards against the canonical/hook drift where one dropped relPath.
    const input = { relPath: "config/app.json", content: "", blockSecrets: true, extraSecretGlobs: ["config/**"] };
    const a = rt.evaluateWrite([], input);
    const b = policy.evaluateWrite({ version: 1, rules: [] }, input);
    expect(a.block).toEqual(b.block);
    expect(a.block).toBe(true); // the path glob must actually match
  });

  it("looksSecret matches for a glob containing a space (space stays literal)", () => {
    // The old runtime sentinel turned the space into `.*`, diverging from canonical.
    const globs = ["my dir/**"];
    for (const rel of ["my dir/app.json", "myXdir/app.json"]) {
      expect(rt.looksSecret(rel, globs, rel)).toEqual(secrets.looksSecret(rel, globs, rel));
    }
    expect(rt.looksSecret("my dir/app.json", globs, "my dir/app.json")).toBe(true);
    expect(rt.looksSecret("myXdir/app.json", globs, "myXdir/app.json")).toBe(false);
  });

  it("evaluateWrite matches for a pathGlob rule containing a space", () => {
    const rule = { id: "r", message: "m", severity: "warn" as const, pathGlob: "my dir/**" };
    const input = { relPath: "my dir/x.ts", content: "", blockSecrets: false, extraSecretGlobs: [] };
    const a = rt.evaluateWrite([rule], input);
    const b = policy.evaluateWrite({ version: 1, rules: [rule] }, input);
    expect(a.findings.length).toEqual(b.findings.length);
    expect(a.findings.length).toBe(1); // the space glob matches in both
  });

  it("pricing (inputCost/outputCost) matches, including the unknown-model fallback and overrides", () => {
    const models = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5", "totally-unknown"];
    const ov = { "claude-opus-4-8": { inputPerMTok: 99, outputPerMTok: 200 } };
    for (const m of models) {
      expect(rt.inputCost(m, 1_000_000)).toBeCloseTo(pricing.inputCost(m, 1_000_000), 9);
      expect(rt.outputCost(m, 1_000_000)).toBeCloseTo(pricing.outputCost(m, 1_000_000), 9);
      expect(rt.inputCost(m, 1_000_000, ov)).toBeCloseTo(pricing.inputCost(m, 1_000_000, ov), 9);
    }
  });

  it("foldSessionIntoLedger matches canonical commitSession over 3 cumulative turns", () => {
    // Simulate a session whose cumulative totals grow each turn, folding both the
    // runtime mirror and the canonical fold and asserting identical ledgers.
    const emptyLedger = () => ({
      version: 1, model: "m", createdAt: "t",
      totals: { inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, reads: 0, writes: 0, sessions: 0, dedupedReads: 0, mapHits: 0 },
      sessions: [] as any[],
    });
    const rtLedger = emptyLedger();
    const canonLedger = emptyLedger();
    for (let turn = 1; turn <= 3; turn++) {
      const s = {
        id: "s1", started: "t0",
        reads: { "a.ts": {} as any, "b.ts": {} as any },
        writes: Array.from({ length: turn }, (_, i) => ({ file: `f${i}.ts`, action: "Write", tokens: 1, at: "t" })),
        editCounts: {}, inputTokens: 100 * turn, outputTokens: 10 * turn,
        inputCost: 0.1 * turn, outputCost: 0.05 * turn, mapHits: turn, mapMisses: 0, dedupedReads: turn,
      };
      rt.foldSessionIntoLedger(rtLedger as any, s as any, "end");
      ledger.foldSessionIntoLedger(canonLedger as any, s as any, "end");
    }
    expect(JSON.stringify(rtLedger)).toEqual(JSON.stringify(canonLedger));
    // And the fold is correct: totals reflect the FINAL cumulative turn, once.
    expect(rtLedger.totals.inputTokens).toBe(300);
    expect(rtLedger.totals.sessions).toBe(1);
    expect(rtLedger.sessions.length).toBe(1);
  });
});
