import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as canon from "../src/state/formats.js";
import * as secrets from "../src/guard/secrets.js";
import * as guard from "../src/guard/path-guard.js";
import * as policy from "../src/guard/policy.js";
import * as resume from "../src/state/resume.js";
import * as rt from "../src/hooks/runtime.js";

/**
 * The zero-dependency hook runtime mirrors several canonical modules. These
 * checks guarantee the mirrors never drift from their source of truth.
 */
describe("hook runtime parity", () => {
  it("parseNeverDo matches", () => {
    const k = "## Never Do\r\n- one\r\n- two\r\n";
    expect(rt.parseNeverDo(k)).toEqual(canon.parseNeverDo(k));
  });

  it("looksSecret matches", () => {
    for (const f of ["id_rsa", "a.pem", "index.ts", ".env.local"]) {
      expect(rt.looksSecret(f)).toEqual(secrets.looksSecret(f));
    }
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

  it("confineToRoot matches (lexical + symlink escape)", () => {
    expect(rt.confineToRoot("/p", "src/a.ts")).toEqual(guard.confineToRoot("/p", "src/a.ts"));
    expect(rt.confineToRoot("/p", "../escape")).toEqual(guard.confineToRoot("/p", "../escape"));
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-parity-"));
    const project = path.join(base, "project");
    const outside = path.join(base, "outside");
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(project, "link"));
    expect(rt.confineToRoot(project, "link/CLAUDE.md")).toEqual(guard.confineToRoot(project, "link/CLAUDE.md"));
    expect(rt.confineToRoot(project, "link/CLAUDE.md")).toBeNull();
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

  it("evaluateWrite matches for a pathGlob rule containing a space", () => {
    const rule = { id: "r", message: "m", severity: "warn" as const, pathGlob: "my dir/**" };
    const input = { relPath: "my dir/x.ts", content: "", blockSecrets: false, extraSecretGlobs: [] };
    const a = rt.evaluateWrite([rule], input);
    const b = policy.evaluateWrite({ version: 1, rules: [rule] }, input);
    expect(a.findings.length).toEqual(b.findings.length);
    expect(a.findings.length).toBe(1); // the space glob matches in both
  });

  it("resume ticket file naming matches canonical ticketFile", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ticket-"));
    const prevRoot = process.env.PACKMIND_ROOT;
    process.env.PACKMIND_ROOT = root;
    try {
      for (const sid of ["session-1", "b0e1/../weird", "long-" + "x".repeat(200)]) {
        expect(rt.resumeTicketFile(sid)).toEqual(resume.ticketFile(root, sid));
      }
    } finally {
      if (prevRoot === undefined) delete process.env.PACKMIND_ROOT;
      else process.env.PACKMIND_ROOT = prevRoot;
    }
  });

  it("blockResumeTicket writes exactly what canonical blockTicket writes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ticket2-"));
    const prevRoot = process.env.PACKMIND_ROOT;
    process.env.PACKMIND_ROOT = root;
    try {
      rt.blockResumeTicket("s1", "2026-07-13T00:00:00.000Z", "2026-07-13T01:00:00.000Z");
      const viaRuntime = JSON.parse(fs.readFileSync(rt.resumeTicketFile("s1"), "utf8"));
      fs.rmSync(rt.resumeTicketFile("s1"));
      resume.blockTicket(root, "s1", "2026-07-13T00:00:00.000Z", "2026-07-13T01:00:00.000Z");
      const viaCanon = JSON.parse(fs.readFileSync(resume.ticketFile(root, "s1"), "utf8"));
      expect(viaRuntime).toEqual(viaCanon);
    } finally {
      if (prevRoot === undefined) delete process.env.PACKMIND_ROOT;
      else process.env.PACKMIND_ROOT = prevRoot;
    }
  });
});
