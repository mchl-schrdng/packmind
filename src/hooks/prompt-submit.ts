import {
  requireState,
  brainPath,
  readJson,
  parseInput,
  readStdin,
  emitContext,
} from "./runtime.js";

interface Solution {
  id: string;
  error?: string;
  cause?: string;
  fix?: string;
  tags?: string[];
}

function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []).slice(0, 40);
}

/**
 * Lightweight LEXICAL recall in the hook (semantic recall lives in the MCP
 * server). Surfaces previously-recorded solutions that share keywords with the
 * user's prompt, so a known fix resurfaces even before Claude calls a tool.
 */
async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt) process.exit(0);

  const kws = new Set(keywords(prompt));
  if (kws.size === 0) process.exit(0);

  const solutions = readJson<Solution[]>(brainPath("solutions.json"), []);
  const scored = solutions
    .map((s) => {
      const hay = keywords([s.error, s.cause, s.fix, ...(s.tags ?? [])].filter(Boolean).join(" "));
      const overlap = hay.filter((w) => kws.has(w)).length;
      return { s, overlap };
    })
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3);

  if (scored.length === 0) process.exit(0);

  const lines = scored.map(
    ({ s }) => `• ${s.error ?? s.id}${s.fix ? ` → fix: ${s.fix}` : ""}`,
  );
  emitContext(
    "UserPromptSubmit",
    "PackMind found related past solutions:\n" + lines.join("\n") +
      "\n(Use the `recall` MCP tool for a deeper semantic search.)",
  );
}

main().catch(() => process.exit(0));
