import * as path from "node:path";

const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".kt", ".c",
  ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".scala", ".sh",
  ".css", ".scss", ".sql", ".json", ".yaml", ".yml", ".toml", ".xml", ".html",
]);

/**
 * Local, offline token estimate. Blends a character-rate model with a word
 * count, which tracks real BPE tokenization more closely than chars alone
 * (whitespace-dense code over-counts on chars; prose under-counts on words).
 */
export function estimateTokens(text: string, hint?: string): number {
  if (!text) return 0;
  const ext = hint ? path.extname(hint).toLowerCase() : "";
  const charsPerToken = CODE_EXT.has(ext) ? 3.5 : 4.0;
  const byChars = text.length / charsPerToken;
  const words = text.trim().length ? text.trim().split(/\s+/).length : 0;
  const byWords = words / 0.75; // ~1.33 tokens per word
  return Math.max(1, Math.round((byChars + byWords) / 2));
}
