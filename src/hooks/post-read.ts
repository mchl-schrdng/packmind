import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  sessionRawKey,
  updateSession,
  hookConfig,
  estimateTokens,
  inputCost,
  parseInput,
  readStdin,
} from "./runtime.js";

function extractContent(input: Record<string, any>): string {
  const resp = input.tool_response ?? input.tool_output;
  if (typeof resp === "string") return resp;
  if (resp && typeof resp === "object") {
    const c = resp.content ?? resp.text ?? resp.output ?? resp.file?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : x?.text ?? "")).join("");
  }
  return "";
}

async function main(): Promise<void> {
  requireState();
  const root = projectRoot();
  const input = parseInput(await readStdin());
  const filePath = input?.tool_input?.file_path as string | undefined;
  if (!filePath) process.exit(0);

  if (confineToRoot(root, filePath) === null) process.exit(0);
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  if (rel.startsWith(".packmind/")) process.exit(0);

  const content = extractContent(input);
  if (!content) process.exit(0);

  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);

  const cfg = hookConfig();
  const tokens = estimateTokens(content, filePath);
  updateSession(rawKey, (session) => {
    const rec = session.reads[rel];
    if (!rec) return; // no matching pre-read record; nothing to reconcile
    const cost = inputCost(session.model ?? cfg.model, tokens, cfg.prices);
    // Account the delta vs. whatever we previously attributed to this read.
    session.inputTokens += tokens - rec.tokens;
    session.inputCost += cost - rec.cost;
    rec.tokens = tokens;
    rec.cost = cost;
    session.lastEventAt = new Date().toISOString();
  });
}

main().catch(() => process.exit(0));
