import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { looksSecret } from "../src/guard/secrets.js";
import { confineToRoot, samePath } from "../src/guard/path-guard.js";
import { evaluateWrite, resolveRules, DEFAULT_POLICY } from "../src/guard/policy.js";

describe("secrets denylist", () => {
  it("flags secrets, allows source", () => {
    for (const f of [".env", "server.pem", "id_rsa", "creds/credentials", "app.keystore"]) {
      expect(looksSecret(f), f).toBe(true);
    }
    for (const f of ["index.ts", "README.md", "envconfig.ts"]) expect(looksSecret(f), f).toBe(false);
  });
});

describe("path guard", () => {
  it("confines and rejects traversal", () => {
    expect(confineToRoot("/p", "src/a.ts")).toBe("/p/src/a.ts");
    expect(confineToRoot("/p", "../escape")).toBeNull();
  });
  it("samePath avoids suffix collisions", () => {
    expect(samePath("/p", "util/a.ts", "src/util/a.ts")).toBe(false);
    expect(samePath("/p", "./src/a.ts", "src/a.ts")).toBe(true);
  });
  it("accepts an absolute path that reaches the project through an aliased ancestor", () => {
    // Same on-disk location, different string prefix: an alias symlink to the
    // project (the portable equivalent of a case-aliased path on macOS). The
    // guard must confine by real location, not string prefix, or every rule
    // silently fails open for such paths.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-alias-"));
    const project = path.join(base, "project");
    fs.mkdirSync(project);
    const alias = path.join(base, "alias");
    fs.symlinkSync(project, alias, "dir");
    const confined = confineToRoot(project, path.join(alias, ".env"));
    expect(confined).toBe(path.join(fs.realpathSync(project), ".env"));
  });
  it("accepts a case-aliased absolute path on case-insensitive filesystems", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-Case-"));
    const project = path.join(base, "Project");
    fs.mkdirSync(project);
    const aliased = path.join(base, "project"); // same directory, different case
    if (!fs.existsSync(aliased)) return; // case-sensitive filesystem: no alias to test
    const confined = confineToRoot(project, path.join(aliased, ".env"));
    expect(confined).toBe(path.join(fs.realpathSync.native(project), ".env"));
  });
  it("rejects a lexically-in-root path whose real ancestor is a symlink out of root", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sym-"));
    const project = path.join(base, "project");
    const outside = path.join(base, "outside");
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    // `project/link` looks in-root lexically, but really points outside it.
    fs.symlinkSync(outside, path.join(project, "link"));
    // A write under the symlink would land in `outside` - must be refused.
    expect(confineToRoot(project, "link/CLAUDE.md")).toBeNull();
    // A genuine in-root path is still accepted (returned in canonical form).
    expect(confineToRoot(project, "src/a.ts")).toBe(path.join(fs.realpathSync(project), "src", "a.ts"));
  });
});

describe("rule resolution", () => {
  function projectWithPolicy(rules: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rules-"));
    fs.mkdirSync(path.join(root, ".packmind"));
    fs.writeFileSync(path.join(root, ".packmind", "policy.json"), JSON.stringify({ version: 1, rules }));
    return root;
  }

  it("dedupes by rule id, local rule wins over the built-in", () => {
    // A policy.json seeded with the same rule id as a built-in (the default
    // template does exactly this) must yield ONE rule, the local variant.
    const root = projectWithPolicy([
      { id: "no-secret-files", message: "local override", severity: "block", secretFile: true },
    ]);
    const rules = resolveRules(root);
    const matching = rules.filter((r) => r.id === "no-secret-files");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.severity).toBe("block");
    expect(matching[0]!.message).toBe("local override");
  });

  it("keeps built-ins and appends distinct local rules", () => {
    const root = projectWithPolicy([
      { id: "no-console-log", message: "no console.log", severity: "warn", content: "console\\.log" },
    ]);
    const ids = resolveRules(root).map((r) => r.id);
    expect(ids).toContain("no-secret-files");
    expect(ids).toContain("no-console-log");
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

describe("policy evaluation", () => {
  it("warns on secret files by default (no block)", () => {
    const r = evaluateWrite(DEFAULT_POLICY, { relPath: ".env", content: "X=1", blockSecrets: false, extraSecretGlobs: [] });
    expect(r.block).toBe(false);
    expect(r.findings.some((f) => f.ruleId === "no-secret-files")).toBe(true);
  });
  it("hard-blocks secret writes when blockSecrets is on", () => {
    const r = evaluateWrite(DEFAULT_POLICY, { relPath: "id_rsa", content: "key", blockSecrets: true, extraSecretGlobs: [] });
    expect(r.block).toBe(true);
  });
  it("matches a content rule and a path rule", () => {
    const policy = {
      version: 1,
      rules: [
        { id: "no-todo-prod", message: "no TODO", severity: "warn" as const, pathGlob: "src/**", content: "TODO" },
      ],
    };
    const hit = evaluateWrite(policy, { relPath: "src/a.ts", content: "// TODO later", blockSecrets: false, extraSecretGlobs: [] });
    expect(hit.findings).toHaveLength(1);
    const miss = evaluateWrite(policy, { relPath: "docs/a.md", content: "// TODO later", blockSecrets: false, extraSecretGlobs: [] });
    expect(miss.findings).toHaveLength(0); // pathGlob restricts to src/
  });
});
