/**
 * What a run costs, and what a conversation costs, at the paid rate.
 *
 * "Small" is not a number you can price a licence against. This turns the
 * token counts a run already records into figures that can go in one.
 *
 *   pnpm --filter @bitc/evals run cost -- --run run.json
 */
import { readFileSync } from 'node:fs';
import { estimateCostUsd, PRICING } from '@bitc/models';

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

interface Run {
  chatModel: string;
  embeddingModel: string;
  outcomes: { inputTokens: number; outputTokens: number }[];
}

const run = JSON.parse(readFileSync(arg('run'), 'utf8')) as Run;
const cases = run.outcomes.length;
const input = run.outcomes.reduce((n, o) => n + o.inputTokens, 0);
const output = run.outcomes.reduce((n, o) => n + o.outputTokens, 0);

const rate = PRICING[run.chatModel];
if (!rate) {
  console.error(
    `No verified rate for ${run.chatModel}. Add one to packages/models/src/pricing.ts ` +
      `with the date it was checked — do not guess.`,
  );
  process.exit(1);
}

const total = estimateCostUsd(run.chatModel, { inputTokens: input, outputTokens: output })!;
const perTurn = total / cases;

const usd = (n: number): string => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

console.log(`\n# Cost — ${run.chatModel}\n`);
console.log(
  `rate: $${rate.inputPer1M}/1M in, $${rate.outputPer1M}/1M out (checked ${rate.checkedAt})`,
);
console.log(`${rate.note ?? ''}\n`);
console.log(
  `${cases} turns · ${input.toLocaleString()} input tokens · ${output.toLocaleString()} output\n`,
);
console.log(`  per eval run (${cases} turns)      ${usd(total)}`);
console.log(`  per turn                         ${usd(perTurn)}`);
console.log(`  per 1,000 turns                  ${usd(perTurn * 1000)}`);
console.log('');

// A real conversation is not one turn. The suite is mostly single-turn, so
// quoting "per conversation" from it without saying so would understate a
// licence by whatever the real turn count is.
console.log('  A conversation is several turns. This suite is mostly single-turn, so:\n');
for (const turns of [2, 3, 5]) {
  console.log(
    `    ${turns}-turn conversation           ${usd(perTurn * turns).padStart(9)}` +
      `   ·  per 1,000: ${usd(perTurn * turns * 1000)}`,
  );
}

console.log(
  `\n  Embeddings are a separate, much smaller line: one query embedding per\n` +
    `  search at $${PRICING[run.embeddingModel]?.inputPer1M ?? '?'}/1M input, on queries of a few dozen tokens.\n` +
    `  Under a cent per 1,000 conversations, and not included above.`,
);
console.log(
  `\n  NOT included: the reranker, which is a chat call per search on the same\n` +
    `  model and is already inside these token counts, and human escalation,\n` +
    `  which is the merchant's cost rather than ours.\n`,
);
