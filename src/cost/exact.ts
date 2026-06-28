/**
 * Exact token counting via Anthropic's count-tokens endpoint. Used only by the
 * CLI and MCP server (never in the synchronous hook path). Returns null when no
 * API key is configured or the request fails — callers fall back to estimates.
 */
export async function countTokensExact(text: string, model: string): Promise<number | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { input_tokens?: number };
    return typeof data.input_tokens === "number" ? data.input_tokens : null;
  } catch {
    return null;
  }
}

export function exactEnabled(mode: "auto" | "never" | "always"): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
