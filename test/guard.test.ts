import { describe, it, expect } from "vitest";
import { looksSecret } from "../src/guard/secrets.js";
import { confineToRoot, samePath } from "../src/guard/path-guard.js";
import { evaluateWrite, DEFAULT_POLICY } from "../src/guard/policy.js";

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
