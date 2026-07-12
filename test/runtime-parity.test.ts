import { describe, it, expect } from "vitest";
import * as canon from "../src/state/formats.js";
import * as est from "../src/cost/estimator.js";
import * as secrets from "../src/guard/secrets.js";
import * as guard from "../src/guard/path-guard.js";
import * as policy from "../src/guard/policy.js";
import * as pricing from "../src/cost/pricing.js";
import * as ledger from "../src/cost/ledger.js";
import * as rt from "../src/hooks/runtime.js";
import * as sess from "../src/state/session.js";
import * as cgit from "../src/change/git.js";
import * as crec from "../src/change/reconcile.js";
import * as celig from "../src/change/eligible.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

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

  it("applySessionStart matches (startup/resume/compact/clear + no-existing)", () => {
    const input = { now: "2026-07-10T00:00:00.000Z", newIncarnationId: "inc-1", sessionId: "s1" };
    const existing = { ...sess.freshRecord({ ...input, source: "startup", newIncarnationId: "inc-0" }), inputTokens: 7 };
    for (const source of ["startup", "resume", "compact", "clear"]) {
      const a = rt.applySessionStart(existing as any, { ...input, source });
      const b = sess.applySessionStart(existing as any, { ...input, source });
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    }
    expect(JSON.stringify(rt.applySessionStart(null, { ...input, source: "startup" })))
      .toEqual(JSON.stringify(sess.applySessionStart(null, { ...input, source: "startup" })));
  });

  it("applySessionEnd / classifySessionEnd match", () => {
    const rec = sess.freshRecord({ source: "startup", now: "t0", newIncarnationId: "inc-0", sessionId: "s1" });
    for (const reason of ["resume", "clear", "logout", "prompt_input_exit", "other", ""]) {
      expect(rt.classifySessionEnd(reason)).toEqual(sess.classifySessionEnd(reason));
      expect(JSON.stringify(rt.applySessionEnd(rec as any, { reason, now: "t1" })))
        .toEqual(JSON.stringify(sess.applySessionEnd(rec as any, { reason, now: "t1" })));
    }
  });

  it("change: parsePorcelainV2 / computeNetChanges / reconcileGit match canonical", () => {
    const z = ["1 .M N... 100644 100644 100644 aaa bbb src/a.ts", "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts", "old.ts", "? u.ts"].join("\0") + "\0";
    expect(JSON.stringify(rt.parsePorcelainV2(z))).toEqual(JSON.stringify(cgit.parsePorcelainV2(z)));

    const b = { hashes: { "a.ts": "h1", "old.ts": "h1" } };
    const c = { hashes: { "a.ts": "h2", "new.ts": "h1" }, renames: [{ from: "old.ts", to: "new.ts" }] };
    expect(JSON.stringify(rt.computeNetChanges(b as any, c as any))).toEqual(JSON.stringify(crec.computeNetChanges(b as any, c as any)));

    const gb = { status: { changed: [{ path: "pre.ts", xy: ".M" }], renames: [] }, hashes: { "pre.ts": "h1" } };
    const gc = { status: { changed: [{ path: "pre.ts", xy: ".M" }, { path: "n.ts", xy: "??" }], renames: [] }, hashes: { "pre.ts": "h2" } };
    expect(JSON.stringify(rt.reconcileGit(gb as any, gc as any))).toEqual(JSON.stringify(crec.reconcileGit(gb as any, gc as any)));
  });

  it("change: isEligiblePath matches canonical for the same rules", () => {
    const root = "/proj";
    const globs = DEFAULT_CONFIG.map.extraSecretGlobs;
    const dirs = DEFAULT_CONFIG.map.excludeDirs;
    for (const rel of ["src/a.ts", ".packmind/x", "node_modules/y.js", "id_rsa", "assets/l.png", "../out.ts"]) {
      expect(rt.isEligiblePath(root, rel, globs, dirs)).toEqual(celig.isEligiblePath(root, rel, DEFAULT_CONFIG));
    }
  });

  it("sessionRawKey matches", () => {
    for (const input of [{ session_id: "a" }, { transcript_path: "/t" }, { session_id: " ", transcript_path: "/t" }, {}]) {
      expect(rt.sessionRawKey(input)).toEqual(sess.sessionRawKey(input));
    }
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
