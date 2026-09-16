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
  // Paid standard tier, from https://ai.google.dev/gemini-api/docs/pricing
  // (checked 2026-09-16). The development key is on the free tier, where this
  // model costs nothing and is capped at 500 requests a day — but the rate
  // here is the PAID one on purpose: it is what a licence has to be priced
  // against, and a zero would make every cost projection read as free.
  //
  // Development usage on the free key is therefore reported at a rate it did
  // not actually pay. That is the correct direction to be wrong in.
  'google:gemini-3.5-flash-lite': {
    inputPer1M: 0.3,
    outputPer1M: 2.5,
    checkedAt: '2026-09-16',
    note: 'paid standard tier; the development key runs on the free tier at 500 requests/day',
  },
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
