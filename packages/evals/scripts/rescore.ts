/**
 * Re-scores a recorded run offline: the recorded model text and tool outputs,
 * put through the gate as it stands now (`gateReply`, the function the loop
 * calls) and scored by the rules a live run uses (`scoreTurn`). No model call.
 *
 *   pnpm --filter @bitc/evals run rescore -- \
 *     --run packages/evals/history/2026-10-11-run.json \
 *     [--cases-at <git-ref>] [--out packages/evals/history/<file>.txt]
 *
 * `--cases-at` scores against the cases and adjudications as they stood at a
 * commit — the run's own, to check that the re-scorer reproduces the verdicts
 * the run recorded before trusting anything else it says.
 *
 * The recorded JSON carries the model's text but not the tool outputs the gate
 * checks it against, so this reads each case's final turn from the database
 * the run wrote to. Like `adjudicate`, it needs that database.
 *
 * What a re-score is: the same replies judged by a different gate or different
 * expectations. What it is not: a measurement of the agent under that gate. A
 * model that is told less often that its reply was withheld writes no
 * differently here, because nothing here asks it to write anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { asTenantId, stripStatusUrls } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey, withTenant } from '@bitc/db';
import { gateReply, loadTenantConfig, systemMessage } from '@bitc/agent';
import {
  adjudicationFile,
  metricsFor,
  scoreTurn,
  sourceIdsFor,
  suiteFile,
  validate,
  type Adjudication,
  type CaseOutcome,
  type EvalCase,
  type ObservedTurn,
  type RunMetrics,
} from '../src/index.ts';
import { writeEvalFile } from '../src/safe-write.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const CASES_DIR = 'packages/evals/cases';
const ADJUDICATIONS = 'packages/evals/adjudications.json';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]
    : undefined;
};

const runPath = arg('run');
if (!runPath) throw new Error('--run <recorded run JSON> is required');
const casesAt = arg('cases-at');
const outPath = arg('out');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every suite file, from the working tree or from a commit. */
const suiteFiles = (): string[] => {
  if (casesAt) {
    return git('ls-tree', '-r', '--name-only', casesAt, '--', CASES_DIR)
      .split('\n')
      .filter((path) => path.endsWith('.json'))
      .map((path) => git('show', `${casesAt}:${path}`));
  }
  const texts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.json'))
        texts.push(readFileSync(join(dir, entry.name), 'utf8'));
    }
  };
  walk(join(REPO_ROOT, CASES_DIR));
  return texts;
};

interface RecordedRun {
  suite: string;
  startedAt: string;
  metrics: RunMetrics;
  outcomes: CaseOutcome[];
}
const run = JSON.parse(readFileSync(join(REPO_ROOT, runPath), 'utf8')) as RecordedRun;

const cases: EvalCase[] = suiteFiles()
  .map((text) => suiteFile.parse(JSON.parse(text)))
  .filter((file) => file.suite === run.suite)
  .flatMap((file) => file.cases);

const adjudications: Adjudication[] = (() => {
  const text = casesAt
    ? git('show', `${casesAt}:${ADJUDICATIONS}`)
    : readFileSync(join(REPO_ROOT, ADJUDICATIONS), 'utf8');
  const file = adjudicationFile.parse(JSON.parse(text));
  if (file.suite !== run.suite) return [];
  const problems = validate(file.adjudications);
  if (problems.length > 0) throw new Error(`Invalid adjudications:\n  ${problems.join('\n  ')}`);
  return file.adjudications;
})();

const tenantId = asTenantId((await resolveTenantByWidgetKey('pk_dev_1886'))!);
const config = await loadTenantConfig(tenantId);

interface TurnRow extends Record<string, unknown> {
  role: string;
  content: string | null;
  tool_calls: { name: string; output: unknown }[] | null;
  retrieval_hits: { chunkId: string }[] | null;
  grounding: {
    status: ObservedTurn['status'];
    rawModelText?: string | null;
    literal?: unknown;
  } | null;
}

/** The case's last customer message and last reply. Earlier turns are its history. */
const finalTurn = async (caseId: string): Promise<{ user: TurnRow; assistant: TurnRow }> => {
  const rows = await withTenant(tenantId, async (tx) => [
    ...(await tx.execute<TurnRow>(sql`
      select m.role, m.content, m.tool_calls, m.retrieval_hits, m.grounding
      from messages m join conversations c on c.id = m.conversation_id
      where c.external_id = ${`eval-${run.startedAt}-${caseId}`}
      order by m.created_at desc
    `)),
  ]);
  const user = rows.find((r) => r.role === 'user');
  const assistant = rows.find((r) => r.role === 'assistant');
  if (!user || !assistant) throw new Error(`${caseId}: no recorded turn in the database`);
  return { user, assistant };
};

const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
};

const outcomes: CaseOutcome[] = [];
/** The gate's verdict on each turn it ran on, for the suppression table. */
const gateOk = new Map<string, boolean>();
for (const recorded of run.outcomes) {
  const testCase = cases.find((c) => c.id === recorded.id);
  if (!testCase) {
    say(`! ${recorded.id}: not in the suite${casesAt ? ` at ${casesAt}` : ''}; skipped`);
    continue;
  }
  const { user, assistant } = await finalTurn(recorded.id);
  const persisted = assistant.grounding;
  const toolCalls = assistant.tool_calls ?? [];

  let status = persisted?.status ?? 'error';
  let reply = assistant.content;
  let grounding: ObservedTurn['grounding'] = null;
  // The gate ran on this turn only if its verdict was persisted. Turns that
  // ended before it — a hard tool failure, a cut-off reply — keep their status.
  if (persisted?.literal && typeof persisted.rawModelText === 'string') {
    const verdict = gateReply({
      text: persisted.rawModelText,
      toolCalls,
      customerText: user.content ?? '',
      brandName: config.brandName,
    });
    grounding = { literal: verdict.literal, citations: verdict.citations };
    gateOk.set(recorded.id, verdict.ok);
    // An escalation outranks the gate in the loop; only these two depend on it.
    if (status === 'answered' || status === 'suppressed') {
      status = verdict.ok ? 'answered' : 'suppressed';
      reply = verdict.ok
        ? verdict.citations.cleanReply || systemMessage('escalated', testCase.lang, config.messages)
        : systemMessage('suppressed', testCase.lang, config.messages);
    }
  }

  const outcome = scoreTurn(testCase, {
    status,
    reply,
    rawModelText: persisted?.rawModelText ?? null,
    toolsCalled: toolCalls.map((t) => t.name),
    citedSources: await sourceIdsFor(tenantId, grounding?.citations.cited ?? []),
    retrievedSources: await sourceIdsFor(
      tenantId,
      (assistant.retrieval_hits ?? []).map((h) => h.chunkId),
    ),
    grounding,
    errorKind: recorded.errorKind,
    latencyMs: recorded.latencyMs,
    inputTokens: recorded.inputTokens,
    outputTokens: recorded.outputTokens,
  });
  outcome.costUsd = recorded.costUsd;
  outcomes.push(outcome);
}
await disconnect();

// Everything the recorded run says about a case, against the re-score.
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
const FIELDS: [string, (o: CaseOutcome) => unknown, ((a: never, b: never) => boolean)?][] = [
  ['passed', (o) => o.passed],
  ['behaviour', (o) => o.behaviour],
  ['failures', (o) => o.failures, sameSet as (a: never, b: never) => boolean],
  // The recorded file went through writeEvalFile, which strips status links.
  ['reply', (o) => (o.reply === null ? null : stripStatusUrls(o.reply))],
  ['hallucinations', (o) => o.hallucinations],
  ['citationMisses', (o) => o.citationMisses],
  ['falseSuppression', (o) => o.falseSuppression],
  ['citedSources', (o) => o.citedSources, sameSet as (a: never, b: never) => boolean],
];

say(`Re-score of ${runPath}`);
say(`  run started ${run.startedAt}, ${run.outcomes.length} cases`);
say(
  `  gate: working tree at ${git('rev-parse', '--short', 'HEAD').trim()}${git('status', '--porcelain').trim() ? ' (uncommitted changes)' : ''}`,
);
say(
  `  cases and adjudications: ${casesAt ? `as at ${casesAt}` : 'working tree'} (${cases.length} cases, ${adjudications.length} adjudications)`,
);
say();

say('Per case, against the recorded run');
let differing = 0;
for (const now of outcomes) {
  const then = run.outcomes.find((o) => o.id === now.id)!;
  const diffs = FIELDS.filter(([, get, eq]) =>
    eq ? !eq(get(then) as never, get(now) as never) : get(then) !== get(now),
  );
  if (diffs.length === 0) continue;
  differing += 1;
  const flip = then.passed === now.passed ? '' : then.passed ? '  PASS → FAIL' : '  FAIL → PASS';
  say(`  ${now.id}${flip}`);
  for (const [name, get] of diffs) {
    say(`    ${name}: ${JSON.stringify(get(then))}`);
    say(`    ${' '.repeat(name.length)}→ ${JSON.stringify(get(now))}`);
  }
}
say(
  differing === 0
    ? '  none — every field compared is identical to the recorded run'
    : `  ${differing} case(s) differ`,
);
say();

const suppressedThen = run.outcomes.filter((o) => o.behaviour === 'suppressed').map((o) => o.id);
say('Replies the recorded run suppressed');
for (const id of suppressedThen) {
  const ok = gateOk.get(id);
  say(
    `  ${id}: ${ok === undefined ? 'gate did not run' : ok ? 'gate passes now' : 'still withheld'}`,
  );
}
say();

const metrics = metricsFor(outcomes, adjudications, cases);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const ROWS: [string, (m: RunMetrics) => string][] = [
  ['cases', (m) => String(m.cases)],
  ['passed', (m) => String(m.passed)],
  ['accuracy as originally scored', (m) => pct(m.accuracyAsOriginallyScored)],
  ['accuracy after adjudication', (m) => pct(m.accuracy)],
  ['adjudicated cases', (m) => String(m.adjudicatedCases)],
  ['fabricated literals delivered', (m) => String(m.fabricatedLiteralsDelivered)],
  ['uncited claims delivered', (m) => String(m.uncitedClaimsDelivered)],
  ['false suppressions', (m) => String(m.falseSuppressionCount)],
  ['gate: literal misses (all turns)', (m) => String(m.hallucinationCount)],
  ['gate: citation misses (all turns)', (m) => String(m.citationMissCount)],
  ['deflection', (m) => pct(m.deflectionRate)],
  ['escalation precision', (m) => pct(m.escalationPrecision)],
];
say(`${'Metric'.padEnd(36)}${'recorded'.padStart(10)}${'re-scored'.padStart(11)}`);
for (const [name, get] of ROWS) {
  say(`  ${name.padEnd(34)}${get(run.metrics).padStart(10)}${get(metrics).padStart(11)}`);
}

const text = `${lines.join('\n')}\n`;
process.stdout.write(text);
if (outPath) writeEvalFile(join(REPO_ROOT, outPath), text);
