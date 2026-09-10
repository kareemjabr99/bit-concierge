/**
 * Per-token rates for cost-per-tenant reporting. USD per 1M tokens.
 *
 * A stale rate makes cost reporting wrong, not the product — so every entry
 * carries the date it was checked, and an unknown rate is recorded as null
 * rather than guessed. Null cost rows are visible in the dashboard as
 * "unpriced", which is the honest state.
 */
export interface Pricing {
  inputPer1M: number;
  outputPer1M: number;
  checkedAt: string;
  note?: string;
}

export const PRICING: Record<string, Pricing | null> = {
  // Introductory rate through 31 Dec 2026, per Google's pricing page.
  // Free tier. Priced null rather than zero: cost reporting shows
  // "unpriced", which is honest, and a paid swap fills this in.
  'google:gemini-3.5-flash-lite': null,
  'google:gemini-3.6-flash': null,
  'google:gemini-3.1-pro-preview': null,
  'google:gemini-embedding-001@1536': { inputPer1M: 0.15, outputPer1M: 0, checkedAt: '2026-09-10' },
  'anthropic:claude-sonnet-5': null,
};

export const estimateCostUsd = (
  key: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null => {
  const p = PRICING[key];
  if (!p) return null;
  return (usage.inputTokens * p.inputPer1M + usage.outputTokens * p.outputPer1M) / 1_000_000;
};
