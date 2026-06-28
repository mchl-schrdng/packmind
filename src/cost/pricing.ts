/**
 * Per-model list prices in USD per million tokens. These are defaults; a
 * project can override any rate via `PACKMIND_PRICE_<MODEL>` env or by editing
 * config later. Unknown models fall back to the most capable tier.
 */
export interface Rate {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICES: Record<string, Rate> = {
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-fable-5": { inputPerMTok: 5, outputPerMTok: 25 },
};

function normalizeModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "claude-opus-4-8";
  if (m.includes("sonnet")) return "claude-sonnet-4-6";
  if (m.includes("haiku")) return "claude-haiku-4-5";
  if (m.includes("fable")) return "claude-fable-5";
  return "claude-opus-4-8";
}

export function rateFor(model: string): Rate {
  return PRICES[normalizeModel(model)] ?? PRICES["claude-opus-4-8"];
}

export function inputCost(model: string, tokens: number): number {
  return (tokens / 1_000_000) * rateFor(model).inputPerMTok;
}

export function outputCost(model: string, tokens: number): number {
  return (tokens / 1_000_000) * rateFor(model).outputPerMTok;
}
