import * as fs from "node:fs";
import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  brainPath,
  readText,
  writeText,
  appendLine,
  readSession,
  writeSession,
  newSession,
  hookConfig,
  parseMap,
  serializeMap,
  describeLite,
  estimateTokens,
  inputCost,
  outputCost,
  looksSecret,
  enqueueRecall,
  parseInput,
  readStdin,
  emitContext,
  type MapEntry,
  type PriceOverrides,
} from "./runtime.js";

function refreshMap(rel: string, content: string, model: string, prices: PriceOverrides): number {
  const map = parseMap(readText(brainPath("map.md")));
  const dir = path.posix.dirname(rel);
  const section = dir === "." ? "./" : dir + "/";
  const file = path.posix.basename(rel);
  const tokens = estimateTokens(content, rel);
  const entry: MapEntry = {
    file,
    description: describeLite(file, content),
    tokens,
    cost: inputCost(model, tokens, prices),
  };
  if (!map.has(section)) map.set(section, []);
  const list = map.get(section)!;
  const idx = list.findIndex((e) => e.file === file);
  if (idx >= 0) {
    if (!entry.description && list[idx].description) entry.description = list[idx].description;
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  let count = 0;
  for (const [, l] of map) count += l.length;
  writeText(brainPath("map.md"), serializeMap(map, { fileCount: count, updated: new Date().toISOString() }));
  return tokens;
}

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
  const tokens = content ? refreshMap(rel, content, cfg.model, cfg.prices) : 0;

  appendLine(
    brainPath("journal.md"),
    `| ${new Date().toISOString().slice(11, 16)} | ${action} | \`${rel}\` | ~${tokens} |\n`,
  );

  if (cfg.recallEnabled && content) enqueueRecall(rel);

  const session = readSession() ?? newSession("s-adhoc");
  delete session.reads[rel]; // a write invalidates the prior read-dedupe guard
  session.writes.push({ file: rel, action, tokens, at: new Date().toISOString() });
  session.editCounts[rel] = (session.editCounts[rel] ?? 0) + 1;
  session.outputTokens += tokens;
  session.outputCost += outputCost(cfg.model, tokens, cfg.prices);
  writeSession(session);

  if (session.editCounts[rel] === 4) {
    emitContext(
      "PostToolUse",
      `You've edited \`${rel}\` several times this session. Consider a different approach and record the lesson via the \`remember\` tool.`,
    );
  }
}

main().catch(() => process.exit(0));
