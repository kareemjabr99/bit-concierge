/**
 * Monthly cost per tenant, at volume. For building a licence model.
 *
 * A unit rate is not a cost curve: most of what this costs does not scale with
 * conversations, and the part that does is small. Quoting "$4.70 per 1,000"
 * without the fixed line underneath would make 500 conversations a month look
 * like a $2 business.
 *
 * Every rate here is verified and carries the date it was checked. Nothing is
 * estimated — where a figure is not known it is absent rather than guessed.
 *
 *   pnpm --filter @bitc/evals run licence-cost
 */

/** Verified 2026-09-16, https://ai.google.dev/gemini-api/docs/pricing */
const CHAT = { inputPer1M: 0.3, outputPer1M: 2.5 };
/** Verified 2026-09-10 */
const EMBED_PER_1M = 0.15;

/**
 * Verified 2026-09-18, https://fly.io/docs/about/pricing/ and /docs/mpg/
 *
 * Managed Postgres Basic is the smallest plan with a production posture. The
 * app runs two shared-cpu-1x machines — one is a single point of failure, and
 * ADR 0001 puts the product in `fra`.
 */
const FLY = {
  vm512PerMonth: 3.32,
  vm1gPerMonth: 5.92,
  postgresBasicPerMonth: 38.0,
  postgresStoragePerGBMonth: 0.28,
};

/** Measured from run 6: 101 complete turns, 465,948 input and 8,206 output. */
const PER_TURN = { input: 4613, output: 81 };
/**
 * Turns per conversation. The suite is mostly single-turn, so this is an
 * assumption rather than a measurement — flagged as one, and the figure a
 * licence should be stress-tested against rather than trusted.
 */
const TURNS_PER_CONVERSATION = 3;
/** ~0.9 searches a turn, a few dozen tokens each. */
const EMBED_TOKENS_PER_TURN = 15;

const chatCost = (conversations: number): number => {
  const turns = conversations * TURNS_PER_CONVERSATION;
  return (
    (turns * PER_TURN.input * CHAT.inputPer1M) / 1e6 +
    (turns * PER_TURN.output * CHAT.outputPer1M) / 1e6
  );
};
const embedCost = (conversations: number): number =>
  (conversations * TURNS_PER_CONVERSATION * EMBED_TOKENS_PER_TURN * EMBED_PER_1M) / 1e6;

/**
 * The platform, shared by every tenant on it.
 *
 * This is the number that decides whether the first customer is profitable, so
 * it is shown whole and then divided, rather than folded into a per-tenant
 * rate that hides it.
 */
const PLATFORM_PER_MONTH =
  FLY.postgresBasicPerMonth +
  FLY.postgresStoragePerGBMonth * 10 +
  FLY.vm512PerMonth * 2 +
  FLY.vm1gPerMonth;

const usd = (n: number): string => `$${n.toFixed(2)}`;
const pad = (s: string, n: number): string => s.padStart(n);

console.log(`\n# Monthly cost per tenant\n`);
console.log(
  `Model rates verified 2026-09-16; infrastructure 2026-09-18. ` +
    `${TURNS_PER_CONVERSATION} turns per conversation is an ASSUMPTION.\n`,
);

console.log('## Variable — scales with conversations\n');
console.log(
  `  ${pad('conversations/mo', 18)} ${pad('model', 10)} ${pad('embeddings', 11)} ${pad('total', 10)} ${pad('per conv', 10)}`,
);
for (const n of [500, 2000, 10000]) {
  const chat = chatCost(n);
  const embed = embedCost(n);
  console.log(
    `  ${pad(n.toLocaleString(), 18)} ${pad(usd(chat), 10)} ${pad(usd(embed), 11)} ` +
      `${pad(usd(chat + embed), 10)} ${pad(`$${((chat + embed) / n).toFixed(4)}`, 10)}`,
  );
}

console.log(`\n## Fixed — the platform, shared by ALL tenants\n`);
console.log(`  Managed Postgres (Basic)      ${pad(usd(FLY.postgresBasicPerMonth), 9)}`);
console.log(`  Postgres storage, 10 GB       ${pad(usd(FLY.postgresStoragePerGBMonth * 10), 9)}`);
console.log(`  App, 2 x shared-cpu-1x 512MB  ${pad(usd(FLY.vm512PerMonth * 2), 9)}`);
console.log(`  Worker, 1 x shared-cpu-1x 1GB ${pad(usd(FLY.vm1gPerMonth), 9)}`);
console.log(`  ${'-'.repeat(38)}`);
console.log(
  `  Platform total                ${pad(usd(PLATFORM_PER_MONTH), 9)}  per month, not per tenant`,
);

console.log(`\n## All-in, by how many tenants share the platform\n`);
console.log(
  `  ${pad('conversations/mo', 18)} ${pad('1 tenant', 11)} ${pad('5 tenants', 11)} ${pad('20 tenants', 11)}`,
);
for (const n of [500, 2000, 10000]) {
  const variable = chatCost(n) + embedCost(n);
  const row = [1, 5, 20].map((t) => usd(variable + PLATFORM_PER_MONTH / t));
  console.log(
    `  ${pad(n.toLocaleString(), 18)} ${pad(row[0]!, 11)} ${pad(row[1]!, 11)} ${pad(row[2]!, 11)}`,
  );
}

console.log(`\n## What this does NOT include\n`);
console.log(
  [
    '  - Human escalation. The merchant pays that, and at ~30% escalation it is',
    '    the largest cost in the whole system — 3,000 tickets a month at 10,000',
    '    conversations. Worth putting in front of a merchant as a saving, not a cost.',
    '  - Bit68 time: onboarding, corpus curation, the Phase 5 validation round.',
    '  - Shopify Partner / app-store fees, which do not exist yet.',
    '  - Re-indexing: a full re-embed of this corpus is about 45k tokens, under a cent.',
    '  - Egress, backups beyond the included snapshots, and any paid monitoring.',
  ].join('\n'),
);
console.log(
  `\n  The model line is ~87% input tokens, because every turn resends the system\n` +
    `  prompt, the tool definitions and the retrieved chunks. Prompt caching is the\n` +
    `  one change that would move this curve materially, and it is not built.\n` +
    `  Scoped in docs/prompt-caching.md.\n`,
);

console.log('## Two arguments, priced differently\n');
console.log(
  [
    '  DEFLECTION is the VALUE argument. At ~30% escalation, 10,000 conversations',
    '  is 3,000 tickets the merchant does not answer. That is the largest number on',
    '  this page by an order of magnitude, it sits in the excluded list because it',
    '  is their cost rather than ours, and it is what the licence is actually sold',
    '  against. It is also the claim that does NOT hold yet: it needs a',
    '  merchant-validated question set.',
    '',
    '  THE BAR is the TRUST argument. Zero fabricated literals and zero uncited',
    '  claims reaching a customer. It is what makes the assistant safe to put in',
    '  front of customers at all, and it holds today — but a system that escalated',
    '  every question would satisfy it perfectly and save nobody anything.',
    '',
    '  They are priced differently because they are different products. Trust is a',
    '  precondition — a floor, and a reason to charge for the platform rather than',
    '  per conversation. Value scales with deflection, and until Phase 5 measures',
    '  it against a signed question set there is no honest number to attach to it.',
    '',
    '  Quoting one as though it were the other is the mistake to avoid in front of',
    '  a merchant: "it never makes things up" is true and is not a reason to buy;',
    '  "it handles 70% of your tickets" is a reason to buy and is not yet proven.',
  ].join('\n'),
);
console.log('');
