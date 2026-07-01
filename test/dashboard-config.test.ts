import { describe, it, expect } from "vitest";
import { applyConfigPatch, summarizeClaudeConfig } from "../src/dashboard/config-api.js";
import { validateRules, DEFAULT_POLICY } from "../src/guard/policy.js";

describe("applyConfigPatch", () => {
  it("applies a valid partial patch and preserves untouched keys", () => {
    const onDisk = { model: "claude-opus-4-8", recall: { enabled: true, topK: 6 } };
    const { config, errors } = applyConfigPatch(onDisk, { "recall.topK": 8, "guard.blockSecrets": true });
    expect(errors).toEqual([]);
    expect((config.recall as any).topK).toBe(8);
    expect((config.recall as any).enabled).toBe(true); // untouched
    expect((config.guard as any).blockSecrets).toBe(true);
    expect(config.model).toBe("claude-opus-4-8"); // untouched
  });

  it("rejects keys outside the editable whitelist and writes nothing", () => {
    const { errors } = applyConfigPatch({}, { "claude.settingsPath": "x", version: 9 });
    expect(errors.length).toBe(2);
    expect(errors.join(" ")).toMatch(/not an editable config key/);
  });

  it("rejects wrong-typed values", () => {
    const wrong = applyConfigPatch({}, { "recall.enabled": "yes" });
    expect(wrong.errors[0]).toMatch(/must be of type boolean/);
    const wrongNum = applyConfigPatch({}, { "recall.topK": "8" });
    expect(wrongNum.errors[0]).toMatch(/must be of type number/);
    const okExact = applyConfigPatch({}, { "cost.exact": "always" });
    expect(okExact.errors).toEqual([]);
    const badExact = applyConfigPatch({}, { "cost.exact": "sometimes" });
    expect(badExact.errors[0]).toMatch(/type exact/);
    const okLean = applyConfigPatch({}, { "guard.lean.mode": "full" });
    expect(okLean.errors).toEqual([]);
    const badLean = applyConfigPatch({}, { "guard.lean.mode": "max" });
    expect(badLean.errors[0]).toMatch(/type leanMode/);
  });
});

describe("validateRules", () => {
  it("accepts the default policy and flags broken rules", () => {
    expect(validateRules(DEFAULT_POLICY.rules)).toEqual([]);
    const problems = validateRules([
      { id: "", message: "", severity: "loud" as any },
      { id: "r2", message: "m", severity: "warn", content: "([" },
    ]);
    expect(problems.join(" ")).toMatch(/missing id/);
    expect(problems.join(" ")).toMatch(/missing message/);
    expect(problems.join(" ")).toMatch(/severity must be warn\|block/);
    expect(problems.join(" ")).toMatch(/matches nothing/);
    expect(problems.join(" ")).toMatch(/invalid content regex/);
  });
});

describe("summarizeClaudeConfig", () => {
  it("flattens hooks and mcp servers and flags managed hooks", () => {
    const settings = {
      hooks: {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "node x.js", timeout: 5 }], _managedBy: "packmind" },
        ],
        PreToolUse: [
          { matcher: "Read", hooks: [{ type: "command", command: "other.sh", timeout: 3 }] },
        ],
      },
    };
    const mcp = { mcpServers: { packmind: { command: "packmind", args: ["mcp"] } } };
    const out = summarizeClaudeConfig(settings, mcp);
    expect(out.hooks).toHaveLength(2);
    expect(out.hooks[0]).toMatchObject({ event: "SessionStart", command: "node x.js", timeout: 5, managed: true });
    expect(out.hooks[1].managed).toBe(false);
    expect(out.mcpServers).toEqual([{ name: "packmind", command: "packmind", args: ["mcp"] }]);
  });

  it("is robust to missing/empty config", () => {
    const out = summarizeClaudeConfig({}, {});
    expect(out).toEqual({ hooks: [], mcpServers: [] });
  });
});
