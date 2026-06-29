/**
 * Per-model list prices in USD per million tokens.
 *
 * These are DEFAULTS and approximate — model pricing changes over time. Override
 * any model's rate in `.packmind/config.json` under `cost.prices`, e.g.:
 *
 *   "cost": { "prices": { "claude-opus-4-8": { "inputPerMTok": 15, "outputPerMTok": 75 } } }
 *
 * Overrides are matched first by the exact model id, then by normalized family.
 */
export interface Rate {
  inputPerMTok: number;
  outputPerMTok: number;
}

export type PriceMap = Record<string, Rate>;

export const PRICES: PriceMap = {
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

export function rateFor(model: string, overrides?: PriceMap): Rate {
  const key = normalizeModel(model);
  return (
    overrides?.[model] ??
    overrides?.[key] ??
    PRICES[key] ??
    PRICES["claude-opus-4-8"]
  );
}

export function inputCost(model: string, tokens: number, overrides?: PriceMap): number {
  return (tokens / 1_000_000) * rateFor(model, overrides).inputPerMTok;
}

export function outputCost(model: string, tokens: number, overrides?: PriceMap): number {
  return (tokens / 1_000_000) * rateFor(model, overrides).outputPerMTok;
}
