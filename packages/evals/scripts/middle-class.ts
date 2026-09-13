/**
 * Answers one question: what does the reranker's middle score mean, and how
 * many cases does it decide?
 *
 * The reranker's rubric emits three verdicts — irrelevant, partial, relevant —
 * mapped to 0.0, 0.5, 1.0. `retrieval_min_score` is compared against them.
 * With the threshold anywhere in (0.5, 1.0] the partial class is excluded and
 * every value in that range selects an identical set; anywhere in (0.0, 0.5]
 * it is admitted. The decision is therefore binary, and the only thing worth
 * measuring is how many cases sit on the wrong side of it.
 *
 *   pnpm --filter @bitc/evals run middle -- --log … [--out-json …]
 *
 * With --out-json it also names the cases, which is the population the A/B
 * run needs. Case attribution comes from the log when the run recorded it, and
 * otherwise from the outcomes: a case that admitted nothing is the only kind
 * whose behaviour a lower threshold can change.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

interface Record_ {
  caseId?: string;
  query: string;
  scores: number[];
  ids: string[];
}
interface Outcome {
  id: string;
  behaviour: string;
  expectedBehaviour: string;
  passed: boolean;
  retrievedSources: string[];
  citedSources: string[];
}

const logPath = arg('log', process.env.BITC_RERANK_LOG ?? '.rerank-scores.jsonl');
const records: Record_[] = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record_);

const tops = records.map((r) => r.scores[0] ?? 0);
const all = records.flatMap((r) => r.scores);
const distinct = [...new Set(all)].sort((a, b) => a - b);
const pct = (n: number, of: number): string =>
  of === 0 ? 'n/a' : `${((n / of) * 100).toFixed(1)}%`;

console.log(`\n# The middle class\n`);
console.log(`${records.length} searches · ${all.length} scored candidates · log ${logPath}\n`);

console.log('## What the scores actually are\n');
console.log(
  `distinct values across every candidate: ${distinct.map((v) => v.toFixed(2)).join(', ')}`,
);
const between =
  all.filter((s) => s > 0 && s < 0.5).length + all.filter((s) => s > 0.5 && s < 1).length;
console.log(`values that are not 0.0, 0.5 or 1.0: ${between} of ${all.length}\n`);

console.log('## Top-1 per search — the number the threshold sees\n');
for (const value of distinct) {
  const n = tops.filter((s) => s === value).length;
  console.log(
    `  ${value.toFixed(2)}  ${String(n).padStart(4)}  ${pct(n, tops.length).padStart(6)}`,
  );
}

const middle = records.filter((r) => (r.scores[0] ?? 0) === 0.5);
console.log(`\n## The ${middle.length} searches whose best candidate is partial\n`);
for (const r of middle) {
  console.log(`  ${r.caseId ? `${r.caseId}  ` : ''}"${r.query}"`);
}

// Cross-check against the run's outcomes. A search scoring 0.5 at a 0.75
// threshold admits nothing, so its case must show zero retrieved sources. If
// the two disagree, the log is not describing the run being analysed and
// nothing below can be trusted.
const outcomesPath = arg('outcomes');
if (outcomesPath && existsSync(outcomesPath)) {
  const outcomes = (JSON.parse(readFileSync(outcomesPath, 'utf8')) as { outcomes: Outcome[] })
    .outcomes;
  const starved = outcomes.filter((o) => o.retrievedSources.length === 0);
  console.log(`\n## Cross-check against outcomes\n`);
  console.log(`cases admitting no source: ${starved.length} of ${outcomes.length}`);
  console.log(
    `  of those, expected to answer: ${starved.filter((o) => o.expectedBehaviour === 'answer').length}`,
  );
  const attributed = new Set(middle.map((r) => r.caseId).filter(Boolean));
  if (attributed.size > 0) {
    const contradictions = [...attributed].filter((id) => !starved.some((o) => o.id === id));
    console.log(
      contradictions.length === 0
        ? '  every partial-scoring case admitted nothing, as it must'
        : `  DISAGREEMENT — these scored 0.5 but admitted a source: ${contradictions.join(', ')}`,
    );
  } else {
    console.log('  log predates case attribution; population taken from outcomes instead');
  }
  const outJson = arg('out-json');
  if (outJson) {
    // The A/B population: every case that admitted nothing. A lower threshold
    // can only change these. Supersetting the 0.5 cases is deliberate — the
    // 0.0 cases are the control, and they must not move.
    writeFileSync(
      outJson,
      `${JSON.stringify(
        starved.map((o) => o.id),
        null,
        2,
      )}\n`,
    );
    console.log(`\n  A/B population written to ${outJson} (${starved.length} cases)`);
  }
}

console.log(`\n## What this means for the threshold\n`);
const partial = tops.filter((s) => s === 0.5).length;
if (distinct.length <= 3 && between === 0) {
  console.log(
    `  The reranker is a three-way classifier, not a scorer. Every threshold in (0.5, 1.0]\n` +
      `  behaves identically, and so does every threshold in (0.0, 0.5]. The configured\n` +
      `  number selects one of two policies and its decimal places are decoration.\n\n` +
      `  ${partial} of ${tops.length} searches (${pct(partial, tops.length)}) turn on which policy is chosen.\n` +
      `  The knob that would actually change a score is the rubric, not the threshold.`,
  );
} else {
  console.log(
    `  ${distinct.length} distinct values, ${between} of them off the three rubric points.\n` +
      `  The threshold has room to discriminate; re-read this before calling it decorative.`,
  );
}
console.log('');
