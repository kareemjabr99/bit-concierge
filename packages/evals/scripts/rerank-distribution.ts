/**
 * Reports the distribution of reranker scores across a run.
 *
 * `retrieval_min_score` gates on this number. If it only ever takes two or
 * three values, then it is a classifier and the threshold is a label, not a
 * calibration — and calling it a calibrated threshold would be dressing a coin
 * toss in a decimal point. This script exists to answer that with the queries
 * the agent actually generated, rather than a handful chosen by hand.
 *
 *   BITC_RERANK_LOG=… pnpm evals run …          # records
 *   pnpm --filter @bitc/evals run distribution -- --log …
 */
import { readFileSync } from 'node:fs';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const path = arg('log', process.env.BITC_RERANK_LOG ?? '.rerank-scores.jsonl');
const threshold = Number(arg('threshold', '0.75'));

interface Record_ {
  query: string;
  scores: number[];
  ids: string[];
}

const records: Record_[] = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record_);

if (records.length === 0) {
  console.error(`No records in ${path}. Run the suite with BITC_RERANK_LOG set.`);
  process.exit(1);
}

const all = records.flatMap((r) => r.scores);
const tops = records.map((r) => r.scores[0] ?? 0);

const tally = (values: number[]): [number, number][] =>
  [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>())].sort(
    (a, b) => a[0] - b[0],
  );

const pct = (n: number, of: number): string => `${((n / of) * 100).toFixed(1)}%`;

console.log(
  `reranker score distribution · ${records.length} searches · ${all.length} scored candidates\n`,
);

console.log('ALL CANDIDATE SCORES');
for (const [value, count] of tally(all)) {
  const bar = '█'.repeat(Math.max(1, Math.round((count / all.length) * 50)));
  console.log(
    `  ${value.toFixed(3)}  ${String(count).padStart(5)}  ${pct(count, all.length).padStart(6)}  ${bar}`,
  );
}

console.log('\nTOP-1 SCORE PER SEARCH — the number the threshold actually sees');
for (const [value, count] of tally(tops)) {
  const bar = '█'.repeat(Math.max(1, Math.round((count / tops.length) * 50)));
  console.log(
    `  ${value.toFixed(3)}  ${String(count).padStart(5)}  ${pct(count, tops.length).padStart(6)}  ${bar}`,
  );
}

const distinctAll = tally(all).length;
const distinctTop = tally(tops).length;
// The band a threshold can actually discriminate inside. A score that never
// lands here is a score the threshold never had to judge.
const inBand = tops.filter((s) => s > 0.5 && s < 1).length;
const allInBand = all.filter((s) => s > 0.5 && s < 1).length;
const above = tops.filter((s) => s >= threshold).length;

console.log('\nCALIBRATION');
console.log(`  distinct values, all candidates   ${distinctAll}`);
console.log(`  distinct values, top-1            ${distinctTop}`);
console.log(
  `  top-1 strictly between 0.5 and 1  ${inBand} of ${tops.length}  (${pct(inBand, tops.length)})`,
);
console.log(
  `  all scores between 0.5 and 1      ${allInBand} of ${all.length}  (${pct(allInBand, all.length)})`,
);
console.log(
  `  top-1 at or above ${threshold}             ${above} of ${tops.length}  (${pct(above, tops.length)})`,
);

console.log('');
if (inBand === 0) {
  console.log(
    `  VERDICT: not a calibrated threshold. No top-1 score lands between 0.5 and 1.0, so\n` +
      `  every value in (0.5, 1.0] selects exactly the same set. ${threshold} is a label on a\n` +
      `  ${distinctTop}-valued classifier, and calling it calibration would be false.`,
  );
} else if (inBand / tops.length < 0.1) {
  console.log(
    `  VERDICT: barely a threshold. Only ${pct(inBand, tops.length)} of searches land in the band a\n` +
      `  threshold can discriminate inside. ${threshold} is doing almost no work that 0.6 or 0.9\n` +
      `  would not do identically.`,
  );
} else {
  console.log(
    `  VERDICT: the threshold discriminates. ${pct(inBand, tops.length)} of searches land between\n` +
      `  0.5 and 1.0, so where the line sits changes the outcome for a real share of queries.`,
  );
}
