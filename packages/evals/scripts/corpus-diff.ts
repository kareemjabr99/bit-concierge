/**
 * Which cases changed when the merchant's clean text replaced the crawled
 * corpus, and which of those changes the corpus can actually be credited with.
 *
 * Two things changed between the last full run on the crawled corpus and the
 * first on the exports: the corpus, and the admission policy. Reporting the
 * difference as one number would attribute both to whichever was more
 * interesting.
 *
 * The attribution is clean anyway, for a reason worth stating rather than
 * assuming. The admission policy only reaches a case whose top candidate
 * scored exactly 0.5 — everywhere else `relevant` and `relevant_or_partial`
 * select an identical set, by construction. So:
 *
 *   - for the 13 cases that scored 0.5, the A/B arm is the control: it ran
 *     them on the CRAWLED corpus with the partial class already admitted, so
 *     A/B arm → new run isolates the corpus;
 *   - for the other 90, the policy change is provably a no-op, so
 *     old run → new run isolates the corpus.
 *
 *   pnpm --filter @bitc/evals run corpus-diff -- --before old.md --ab ab.json --after new.json
 */
import { readFileSync } from 'node:fs';

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

interface Outcome {
  id: string;
  passed: boolean;
  behaviour: string;
  expectedBehaviour: string;
  failures: string[];
  reply: string;
  citedSources: string[];
  retrievedSources: string[];
}

/** The old run predates --out-json; its failing ids come from the report. */
const failedInReport = (path: string): Set<string> =>
  new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('**'))
      .map((l) => l.split('**')[1]!),
  );

const outcomes = (path: string): Map<string, Outcome> =>
  new Map(
    (JSON.parse(readFileSync(path, 'utf8')) as { outcomes: Outcome[] }).outcomes.map((o) => [
      o.id,
      o,
    ]),
  );

/**
 * Cases that never reached the model in the baseline run.
 *
 * Run 3 hit the daily quota wall and five cases came back as errors. They were
 * scored as failures, so a later run that merely completes shows them as
 * "fixed" — four of the first ten fixes in this diff were exactly that, and
 * nothing about the corpus caused any of them. A case with no verdict has
 * nothing to compare against, so it is excluded rather than counted.
 */
const incomplete = new Set(
  (arg('exclude') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean),
);

const before = failedInReport(arg('before'));
const ab = arg('ab') ? outcomes(arg('ab')) : new Map<string, Outcome>();
const after = outcomes(arg('after'));

// Cases whose top candidate scored 0.5 on the crawled corpus: the only ones the
// admission policy could reach.
const PARTIAL = new Set(
  (
    arg('partial') ||
    'order-status-partial-refund,returns-partial-order,returns-proof-of-purchase,' +
      'returns-sale-exchange,shipping-cost,shipping-gcc,shipping-track-how,' +
      'sizing-no-chart-for-product,stock-new-collection,unanswerable-opening-hours,' +
      'unanswerable-payment-methods,unanswerable-price-match,unanswerable-stock-in-store'
  )
    .split(',')
    .map((s) => s.trim()),
);

interface Row {
  id: string;
  from: 'pass' | 'FAIL';
  to: 'pass' | 'FAIL';
  control: string;
  o: Outcome;
}

const rows: Row[] = [];
for (const [id, o] of after) {
  if (incomplete.has(id)) continue;
  const isPartial = PARTIAL.has(id);
  // For a partial case the honest baseline is the A/B arm, which already had
  // the policy change applied. Falling back to the old run when the A/B arm
  // did not cover it, and saying so.
  const controlOutcome = isPartial ? ab.get(id) : undefined;
  const wasFail = controlOutcome ? !controlOutcome.passed : before.has(id);
  const control = isPartial
    ? controlOutcome
      ? 'A/B arm (crawled + partial admitted)'
      : 'old run — CONFLATED, policy also changed'
    : 'old run (policy change is a no-op here)';
  if (wasFail !== !o.passed) {
    rows.push({
      id,
      from: wasFail ? 'FAIL' : 'pass',
      to: o.passed ? 'pass' : 'FAIL',
      control,
      o,
    });
  }
}

const fixed = rows.filter((r) => r.to === 'pass');
const broke = rows.filter((r) => r.to === 'FAIL');

console.log(`\n# Cases changed by the merchant exports\n`);
console.log(
  `${after.size - incomplete.size} comparable cases · ${rows.length} changed · ` +
    `${fixed.length} fixed · ${broke.length} broke`,
);
if (incomplete.size > 0) {
  console.log(
    `${incomplete.size} excluded: never reached the model in the baseline run, so there is ` +
      `no verdict to compare (${[...incomplete].join(', ')})`,
  );
}
console.log('');

for (const [label, set] of [
  ['FIXED', fixed],
  ['BROKE', broke],
] as const) {
  if (set.length === 0) continue;
  console.log(`\n## ${label} (${set.length})\n`);
  for (const r of set) {
    console.log(`### ${r.id}   ${r.from} → ${r.to}`);
    console.log(`  control: ${r.control}`);
    console.log(`  behaviour: ${r.o.behaviour} (expected ${r.o.expectedBehaviour})`);
    if (r.o.failures.length > 0) console.log(`  failures: ${r.o.failures.join('; ')}`);
    console.log(`  cited: ${JSON.stringify(r.o.citedSources)}`);
    console.log(`  reply: ${(r.o.reply || '').replace(/\s+/g, ' ').slice(0, 220)}`);
    console.log('');
  }
}

const conflated = rows.filter((r) => r.control.includes('CONFLATED'));
if (conflated.length > 0) {
  console.log(
    `\n${conflated.length} change(s) could not be attributed to the corpus alone: ` +
      `${conflated.map((r) => r.id).join(', ')}`,
  );
}
