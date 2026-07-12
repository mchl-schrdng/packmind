import * as fs from "node:fs";
import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  brainPath,
  appendLine,
  sessionRawKey,
  updateSession,
  readSessionFor,
  recordChangeCandidate,
  hookConfig,
  upsertMapEntry,
  outputCost,
  looksSecret,
  enqueueRecall,
  parseInput,
  readStdin,
  emitContext,
} from "./runtime.js";

async function main(): Promise<void> {
  requireState();
  const root = projectRoot();
  const cfg = hookConfig();
  const input = parseInput(await readStdin());
  const ti = input.tool_input ?? {};
  const filePath = ti.file_path as string | undefined;
  if (!filePath) process.exit(0);

  if (confineToRoot(root, filePath) === null) process.exit(0);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel.startsWith(".packmind/")) process.exit(0);
  if (looksSecret(filePath, cfg.extraSecretGlobs, rel)) process.exit(0);

  let content = "";
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    /* file may have been deleted */
  }

  const action = (input.tool_name as string) || "edit";
  // Locked read-modify-write of map.md so parallel PostToolUse hooks can't
  // clobber each other's map entries (the old unlocked read + locked write did).
  const tokens = content ? upsertMapEntry(rel, content, cfg.model, cfg.prices) : 0;

  appendLine(
    brainPath("journal.md"),
    `| ${new Date().toISOString().slice(11, 16)} | ${action} | \`${rel}\` | ~${tokens} |\n`,
  );

  if (cfg.recallEnabled && content) enqueueRecall(rel);

  // Locked read-modify-write on this session's own file so a concurrent hook
  // (a parallel Read, or the MCP record_evidence tool) can't lose the update.
  const rawKey = sessionRawKey(input);
  const at = new Date().toISOString();
  let editCount = 0;
  if (rawKey) {
    updateSession(rawKey, (session) => {
      delete session.reads[rel]; // a write invalidates the prior read-dedupe guard
      session.writes.push({ file: rel, action, tokens, at });
      session.editCounts[rel] = (session.editCounts[rel] ?? 0) + 1;
      session.outputTokens += tokens;
      session.outputCost += outputCost(session.model ?? cfg.model, tokens, cfg.prices);
      session.lastEventAt = at;
      editCount = session.editCounts[rel];
    });

    // Record an immediate change candidate; the Stop reconcile is authoritative
    // and will correct the kind (add/modify/delete) from the filesystem.
    const session = readSessionFor(rawKey);
    if (session) {
      recordChangeCandidate(root, session, { path: rel, kind: fs.existsSync(abs) ? "modify" : "delete" }, "post-tool", at);
    }
  }

  if (editCount === 4) {
    emitContext(
      "PostToolUse",
      `You've edited \`${rel}\` several times this session. Consider a different approach and record the lesson via the \`remember\` tool.`,
    );
  }
}

main().catch(() => process.exit(0));
