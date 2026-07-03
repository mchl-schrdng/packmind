import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  brainPath,
  readJson,
  updateJson,
  hookConfig,
  evaluateWrite,
  parseNeverDo,
  readText,
  parseInput,
  readStdin,
  readSession,
  leanNudge,
  emitContext,
  emitDeny,
  type Rule,
  type Session,
} from "./runtime.js";

function pendingContent(input: Record<string, any>): string {
  const ti = input.tool_input ?? {};
  const parts = [ti.content, ti.new_string, ti.new_str];
  // MultiEdit carries its changes in edits[].new_string - include them so
  // content rules and Never-Do guards aren't bypassed by MultiEdit.
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) parts.push(e?.new_string, e?.new_str);
  }
  return parts.filter((x) => typeof x === "string").join("\n");
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

  // The effective guard set (default rules + active practice packs + local
  // policy.json) is pre-resolved by init/update; fall back to policy.json for a
  // project that predates it.
  const effective = readJson<{ rules?: Rule[] }>(brainPath("guard.effective.json"), {});
  const rules = effective.rules ?? readJson<{ rules?: Rule[] }>(brainPath("policy.json"), {}).rules ?? [];
  const { findings, block } = evaluateWrite(rules, {
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
      notes.push(`Known solution for this area - ${s.error}${s.fix ? ` → ${s.fix}` : ""}`);
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

  // Lean-mode nudge: a reuse-first reminder at the moment code is about to land.
  // In "lite" it latches once per session, so persist the session when it fires.
  const session = readSession();
  if (session) {
    const lean = leanNudge(cfg.leanMode, session);
    if (lean) notes.push(lean);
    // Persist only the latch, and inside a lock, so a parallel post-write's
    // token/write accounting isn't clobbered by this read-modify-write.
    if (cfg.leanMode === "lite" && session.notifiedLean) {
      updateJson<Session | null>(brainPath("state", "session.json"), null, (prev) => {
        if (prev) prev.notifiedLean = true;
        return prev;
      });
    }
  }

  if (notes.length) emitContext("PreToolUse", notes.join(" "));
}

main().catch(() => process.exit(0));
