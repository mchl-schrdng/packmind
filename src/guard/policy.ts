import { looksSecret } from "./secrets.js";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";

export type Severity = "warn" | "block";

export interface Rule {
  id: string;
  message: string;
  severity: Severity;
  /** Match the write target against a glob on its project-relative path. */
  pathGlob?: string;
  /** Match a regex against the written content. */
  content?: string;
  /** Match any secret-looking file target. */
  secretFile?: boolean;
}

export interface Policy {
  version: number;
  rules: Rule[];
}

export const DEFAULT_POLICY: Policy = {
  version: 1,
  rules: [
    {
      id: "no-secret-files",
      message: "This path looks like a secrets/credentials file. PackMind will not index it.",
      severity: "warn",
      secretFile: true,
    },
  ],
};

/** Static validation of one guardrail rule. Returns human-readable issues (empty = valid). */
export function validateRule(rule: Rule): string[] {
  const issues: string[] = [];
  if (!rule.id) issues.push("missing id");
  if (!rule.message) issues.push("missing message");
  if (rule.severity !== "warn" && rule.severity !== "block") issues.push("severity must be warn|block");
  if (!rule.secretFile && !rule.pathGlob && !rule.content) {
    issues.push("rule matches nothing (need secretFile/pathGlob/content)");
  }
  if (rule.content) {
    try {
      new RegExp(rule.content);
    } catch {
      issues.push("invalid content regex");
    }
  }
  return issues;
}

/** Validate a whole rule set; returns flattened "<id>: <issue>" problems (empty = valid). */
export function validateRules(rules: Rule[]): string[] {
  const problems: string[] = [];
  for (const r of rules ?? []) {
    for (const issue of validateRule(r)) problems.push(`${r.id || "(no id)"}: ${issue}`);
  }
  return problems;
}

/**
 * Compose the effective rule set: DEFAULT_POLICY rules overlaid by the user's
 * local policy.json rules.
 */
export function resolveRules(root: string): Rule[] {
  const local = readJsonOr<{ rules?: Rule[] }>(brain(root).policy, {});
  return [...DEFAULT_POLICY.rules, ...(Array.isArray(local.rules) ? local.rules : [])];
}

/** Regenerate .packmind/guard.effective.json (the file the pre-write hook reads). */
export function writeEffective(root: string): void {
  writeJson(brain(root).effective, { version: 1, rules: resolveRules(root) });
}

export interface Finding {
  ruleId: string;
  message: string;
  severity: Severity;
}

export interface GuardInput {
  relPath: string;
  content: string;
  blockSecrets: boolean;
  extraSecretGlobs: string[];
}

/** Compile a path glob (`**`, `*`, `?`) to an anchored, case-insensitive regex. */
export function globToRe(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*|\?/g, (m) => (m === "**" ? ".*" : m === "*" ? "[^/]*" : "."));
  return new RegExp(`^${body}$`, "i");
}

/** Evaluate a pending write. Returns findings and whether to hard-block. */
export function evaluateWrite(policy: Policy, input: GuardInput): { findings: Finding[]; block: boolean } {
  const findings: Finding[] = [];
  const isSecret = looksSecret(input.relPath, input.extraSecretGlobs, input.relPath);

  for (const rule of policy.rules ?? []) {
    // A rule's conditions are ANDed: every condition it specifies must match.
    const conditions: boolean[] = [];
    if (rule.secretFile) conditions.push(isSecret);
    if (rule.pathGlob) conditions.push(globToRe(rule.pathGlob).test(input.relPath));
    if (rule.content) {
      try {
        conditions.push(new RegExp(rule.content).test(input.content));
      } catch {
        conditions.push(false); // invalid regex never matches
      }
    }
    if (conditions.length > 0 && conditions.every(Boolean)) {
      findings.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
    }
  }

  // Opt-in: escalate secret-file writes to a hard block.
  if (input.blockSecrets && isSecret) {
    findings.push({
      ruleId: "block-secrets",
      message: "Writing to a secrets file is blocked by policy (guard.blockSecrets).",
      severity: "block",
    });
  }

  return { findings, block: findings.some((f) => f.severity === "block") };
}
