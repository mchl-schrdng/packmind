import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  brainPath,
  readJson,
  hookConfig,
  evaluateWrite,
  parseNeverDo,
  readText,
  parseInput,
  readStdin,
  emitContext,
  emitDeny,
  type Rule,
} from "./runtime.js";

function pendingContent(input: Record<string, any>): string {
  const ti = input.tool_input ?? {};
  return [ti.content, ti.new_string, ti.new_str].filter((x) => typeof x === "string").join("\n");
}

async function main(): Promise<void> {
  requireState();
  const root = projectRoot();
  const input = parseInput(await readStdin());
  const filePath = input?.tool_input?.file_path as string | undefined;
  if (!filePath) process.exit(0);
  if (confineToRoot(root, filePath) === null) process.exit(0);

  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  const content = pendingContent(input);
  const cfg = hookConfig();

  const policy = readJson<{ rules: Rule[] }>(brainPath("policy.json"), { rules: [] });
  const { findings, block } = evaluateWrite(policy.rules, {
    relPath: rel,
    content,
    blockSecrets: cfg.blockSecrets,
    extraSecretGlobs: cfg.extraSecretGlobs,
  });

  if (block) {
    const reasons = findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ");
    emitDeny(`PackMind guardrail blocked this write to \`${rel}\`: ${reasons}`);
    return;
  }

  const notes: string[] = findings.map((f) => `Guardrail (${f.ruleId}): ${f.message}`);

  // Surface known solutions relevant to this file (by recorded file or by path
  // keyword overlap with the solution's error/tags) so a past fix resurfaces
  // before re-debugging.
  const solutions = readJson<any[]>(brainPath("solutions.json"), []);
  if (solutions.length) {
    const pathTokens = new Set((rel.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []));
    const relevant = solutions
      .map((s) => {
        let score = 0;
        if (s.file && s.file === rel) score += 5;
        const hay = `${s.error ?? ""} ${(s.tags ?? []).join(" ")}`.toLowerCase();
        for (const w of hay.match(/[a-z0-9]{4,}/g) ?? []) if (pathTokens.has(w)) score += 1;
        return { s, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const { s } of relevant) {
      notes.push(`Known solution for this area — ${s.error}${s.fix ? ` → ${s.fix}` : ""}`);
    }
  }

  // Surface relevant Never-Do notes from knowledge.md.
  if (content) {
    for (const entry of parseNeverDo(readText(brainPath("knowledge.md")))) {
      const token = entry.match(/[`"']([^`"']{2,})[`"']/)?.[1];
      if (token && new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(content)) {
        notes.push(`knowledge.md Never-Do: "${entry}"`);
      }
    }
  }

  if (notes.length) emitContext("PreToolUse", notes.join(" "));
}

main().catch(() => process.exit(0));
