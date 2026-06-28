import { describe, it, expect } from "vitest";
import * as canon from "../src/state/formats.js";
import * as est from "../src/cost/estimator.js";
import * as secrets from "../src/guard/secrets.js";
import * as guard from "../src/guard/path-guard.js";
import * as policy from "../src/guard/policy.js";
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
});
