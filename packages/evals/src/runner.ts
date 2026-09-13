import { execFileSync } from 'node:child_process';
import { eq, inArray } from 'drizzle-orm';
import { asTenantId, type TenantId } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import { runTurn, type TurnDeps, type TurnResult } from '@bitc/agent';
import { estimateCostUsd } from '@bitc/models';
import type { CaseOutcome, EvalCase, RunMetrics, RunResult } from './types.ts';
import { tierOf } from './types.ts';
import type { Adjudication } from './adjudication.ts';

/**
 * Runs the golden set through the real agent loop against the real retriever.
 *
 * Nothing in here branches on which model or which tier a key belongs to.
 * Pacing comes from `ChatModelSpec.quota`, which is per-model configuration —
 * swapping to a paid key changes a registry entry and nothing in this file.
 * See ADR 0006.
 */

export interface RunOptions {
  tenantId: TenantId;
  suite: string;
  deps: TurnDeps;
  cases: EvalCase[];
  /** Run only these case ids. For isolating an experiment to the cases it affects. */
  only?: string[] | undefined;
  /** Recorded reclassifications, so both scores can be reported. */
  adjudications?: Adjudication[];
  /** Called after each case, for progress output. */
  onCase?: (outcome: CaseOutcome, index: number, total: number) => void;
  /**
   * Called before each case. The reranker log is keyed on this, so a score can
   * be attributed to the case that produced it rather than inferred from the
   * order two files happen to be written in.
   */
  onCaseStart?: (testCase: EvalCase, index: number, total: number) => void;
  /** The model the ship bar must be measured on. Mismatch fails the gate. */
  productionChatModel?: string | null;
}

const gitSha = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

/**
 * Spaces requests to the model's stated rate. A limiter belongs to the harness,
 * not the loop: a customer's turn must never be delayed because an eval suite
 * is what the quota was sized for.
 */
const paced = (requestsPerMinute: number | undefined, callsPerTurn: number) => {
  if (!requestsPerMinute) return async (): Promise<void> => {};
  // Pace from the measured cost of a turn, not a guess. Hitting the per-minute
  // ceiling is not merely slow: the SDK retries three times, so every 429
  // triples what that call takes out of the DAILY budget. Under-pacing is how
  // the 12 Sep run spent 500 requests in 61 cases.
  const gapMs = Math.ceil((60_000 / requestsPerMinute) * callsPerTurn);
  let previous = 0;
  return async (): Promise<void> => {
    const wait = previous + gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    previous = Date.now();
  };
};

const contains = (haystack: string | null, needle: string): boolean =>
  (haystack ?? '').toLowerCase().includes(needle.toLowerCase());

/** Chunk ids are opaque; a case names the document it expects to be cited. */
const sourceIdsFor = async (tenantId: TenantId, chunkIds: string[]): Promise<string[]> => {
  const ids = chunkIds.filter((id) => !id.startsWith('t:'));
  const toolSources = chunkIds.filter((id) => id.startsWith('t:'));
  if (ids.length === 0) return toolSources;
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ sourceId: schema.documents.sourceId })
      .from(schema.chunks)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.chunks.documentId))
      .where(inArray(schema.chunks.id, ids)),
  );
  return [...new Set([...toolSources, ...rows.map((row) => row.sourceId)])];
};

const evaluate = async (
  tenantId: TenantId,
  testCase: EvalCase,
  turn: TurnResult,
): Promise<CaseOutcome> => {
  const failures: string[] = [];
  const reply = turn.reply;
  const toolsCalled = turn.recorder.toolCalls.map((call) => call.name);

  const citedSources = await sourceIdsFor(tenantId, turn.grounding?.citations.cited ?? []);
  const retrievedSources = await sourceIdsFor(
    tenantId,
    turn.recorder.retrievalHits.map((hit) => hit.chunkId),
  );

  const behaviour =
    turn.status === 'answered' ? 'answer' : turn.status === 'escalated' ? 'escalate' : turn.status;

  // A refusal is an answer that declines. The distinction the case cares about
  // is whether a human was pulled in, so `refuse` accepts an answered turn and
  // checks the content expectations to confirm it declined.
  const behaviourOk =
    testCase.expect.behaviour === 'refuse'
      ? behaviour === 'answer'
      : behaviour === testCase.expect.behaviour;
  if (!behaviourOk) failures.push(`expected to ${testCase.expect.behaviour}, got ${behaviour}`);

  for (const needle of testCase.expect.mustContain) {
    if (!contains(reply, needle)) failures.push(`reply is missing "${needle}"`);
  }
  for (const needle of testCase.expect.mustNotContain) {
    if (contains(reply, needle)) failures.push(`reply contains "${needle}", which is wrong`);
  }
  for (const tool of testCase.expect.mustCallTools) {
    if (!toolsCalled.includes(tool)) failures.push(`did not call ${tool}`);
  }
  for (const tool of testCase.expect.mustNotCallTools) {
    if (toolsCalled.includes(tool)) failures.push(`called ${tool}, which it should not`);
  }
  if (testCase.expect.citesAnyOf.length > 0 && behaviour === 'answer') {
    const hit = testCase.expect.citesAnyOf.some((source) => citedSources.includes(source));
    if (!hit)
      failures.push(
        `cited ${JSON.stringify(citedSources)}, none of ${JSON.stringify(testCase.expect.citesAnyOf)}`,
      );
  }

  const hallucinations = turn.grounding?.literal.misses.length ?? 0;
  const citationMisses = turn.grounding?.citations.misses.length ?? 0;
  if (hallucinations > 0) failures.push(`${hallucinations} fabricated literal(s)`);

  const falseSuppression = turn.status === 'suppressed' && testCase.expect.behaviour === 'answer';

  return {
    id: testCase.id,
    category: testCase.category,
    lang: testCase.lang,
    passed: failures.length === 0,
    failures,
    behaviour,
    expectedBehaviour: testCase.expect.behaviour,
    reply,
    rawModelText: turn.rawModelText,
    toolsCalled,
    citedSources,
    retrievedSources,
    hallucinations,
    citationMisses,
    falseSuppression,
    latencyMs: turn.latencyMs,
    inputTokens: turn.usage.inputTokens,
    outputTokens: turn.usage.outputTokens,
    // Priced by the caller, which knows the model key. Left null here so a
    // direct call to evaluate() reports "unpriced" rather than a wrong zero.
    costUsd: null,
  };
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

export const metricsFor = (
  outcomes: CaseOutcome[],
  adjudications: Adjudication[] = [],
): RunMetrics => {
  // A case whose expectation was rewritten and now passes would have failed as
  // first drafted. That is what the original figure counts.
  const adjudicated = new Set(adjudications.map((a) => a.caseId));
  const rescuedByAdjudication = outcomes.filter((o) => adjudicated.has(o.id) && o.passed).length;
  const answerable = outcomes.filter((o) => o.expectedBehaviour !== 'escalate');
  const escalated = outcomes.filter((o) => o.behaviour === 'escalate');
  const withSources = outcomes.filter(
    (o) => o.retrievedSources.length > 0 || o.citedSources.length > 0,
  );
  const costs = outcomes.map((o) => o.costUsd).filter((c): c is number => c !== null);

  return {
    cases: outcomes.length,
    passed: outcomes.filter((o) => o.passed).length,
    failed: outcomes.filter((o) => !o.passed).length,
    accuracy: outcomes.length ? outcomes.filter((o) => o.passed).length / outcomes.length : 0,
    accuracyAsOriginallyScored: outcomes.length
      ? (outcomes.filter((o) => o.passed).length - rescuedByAdjudication) / outcomes.length
      : 0,
    adjudicatedCases: adjudicated.size,
    deflectionRate: answerable.length
      ? answerable.filter((o) => o.behaviour === 'answer').length / answerable.length
      : 0,
    escalationPrecision: escalated.length
      ? escalated.filter((o) => o.expectedBehaviour === 'escalate').length / escalated.length
      : 1,
    retrievalHitRate: withSources.length
      ? withSources.filter((o) => o.retrievedSources.length > 0).length / withSources.length
      : 0,
    hallucinationCount: outcomes.reduce((n, o) => n + o.hallucinations, 0),
    citationMissCount: outcomes.reduce((n, o) => n + o.citationMisses, 0),
    falseSuppressionCount: outcomes.filter((o) => o.falseSuppression).length,
    p95LatencyMs: percentile(
      outcomes.map((o) => o.latencyMs),
      95,
    ),
    costPerConversationUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
  };
};

/**
 * The section 9 ship bar, as a gate rather than a report.
 *
 * Deterministic metrics only. Semantic policy accuracy is a sampled human
 * review with no automated score, and it never enters this decision —
 * see ADR 0005.
 */
export const shipBar = (
  result: Omit<RunResult, 'meetsShipBar' | 'shipBarNotes'>,
  productionChatModel: string | null | undefined,
): { meets: boolean; notes: string[] } => {
  const notes: string[] = [];
  const { metrics } = result;

  if (result.tier !== 'validated') {
    notes.push('provisional suite — proves the machinery, not the ship bar');
  }
  if (productionChatModel && productionChatModel !== result.chatModel) {
    notes.push(
      `measured on ${result.chatModel}, ship bar is ${productionChatModel} — every number here describes a different system`,
    );
  }
  if (metrics.hallucinationCount > 0)
    notes.push(`${metrics.hallucinationCount} fabricated literal(s) — pass/fail`);
  if (metrics.citationMissCount > 0)
    notes.push(`${metrics.citationMissCount} uncited policy claim(s) — pass/fail`);
  // The ship bar reads the ORIGINAL score. A bar that can be cleared by
  // rewriting expectations is not a bar.
  if (metrics.accuracyAsOriginallyScored < 0.95) {
    notes.push(
      `accuracy as originally scored ${(metrics.accuracyAsOriginallyScored * 100).toFixed(1)}% is below 95%` +
        (metrics.adjudicatedCases > 0
          ? ` (${(metrics.accuracy * 100).toFixed(1)}% after ${metrics.adjudicatedCases} adjudication(s))`
          : ''),
    );
  }
  if (metrics.deflectionRate < 0.6)
    notes.push(`deflection ${(metrics.deflectionRate * 100).toFixed(1)}% is below 60%`);

  return { meets: notes.length === 0, notes };
};

export const runSuite = async (options: RunOptions): Promise<RunResult> => {
  const { tenantId, deps, cases } = options;
  const wait = paced(
    deps.chat.spec.quota?.requestsPerMinute,
    deps.chat.spec.quota?.callsPerTurn ?? 4,
  );
  const startedAt = new Date().toISOString();
  const outcomes: CaseOutcome[] = [];

  for (const [index, testCase] of cases.entries()) {
    options.onCaseStart?.(testCase, index, cases.length);
    await wait();
    // A fresh conversation per case: history is what the case declares, never
    // what the previous case happened to leave behind.
    const externalId = `eval-${startedAt}-${testCase.id}`;
    for (const prior of testCase.history) {
      await runTurn(
        {
          tenantId,
          channel: 'web',
          externalConversationId: externalId,
          text: prior,
          localeHint: testCase.lang,
        },
        deps,
      );
      await wait();
    }
    const turn = await runTurn(
      {
        tenantId,
        channel: 'web',
        externalConversationId: externalId,
        text: testCase.input,
        localeHint: testCase.lang,
      },
      deps,
    );
    const outcome = await evaluate(tenantId, testCase, turn);
    outcome.costUsd = estimateCostUsd(deps.chat.spec.key, turn.usage);
    outcomes.push(outcome);
    options.onCase?.(outcome, index, cases.length);
  }

  const metrics = metricsFor(outcomes, options.adjudications ?? []);
  // A turn that never reached the model is not a result. Counting those as
  // failures makes a quota wall look like a quality collapse, and a baseline
  // recorded from one is a trap for the next diff.
  const quotaExhausted = outcomes.filter((o) => o.behaviour === 'error').length;
  const base = {
    suite: options.suite,
    tier: tierOf(cases),
    gitSha: gitSha(),
    chatModel: deps.chat.spec.key,
    embeddingModel: 'unknown',
    reranker: 'unknown',
    startedAt,
    metrics,
    outcomes,
  };
  const bar = shipBar(base, options.productionChatModel);
  const notes =
    quotaExhausted > 0
      ? [`${quotaExhausted} case(s) never reached the model — this run is incomplete`, ...bar.notes]
      : bar.notes;
  return {
    ...base,
    meetsShipBar: bar.meets && quotaExhausted === 0,
    shipBarNotes: notes,
    incompleteCases: quotaExhausted,
  };
};

export const persistRun = async (tenantId: TenantId, result: RunResult): Promise<string> =>
  withTenant(asTenantId(tenantId), async (tx) => {
    const [row] = await tx
      .insert(schema.evalRuns)
      .values({
        tenantId,
        gitSha: result.gitSha,
        suite: result.suite,
        tier: result.tier,
        chatModel: result.chatModel,
        embeddingModel: result.embeddingModel,
        reranker: result.reranker,
        passed: result.metrics.passed,
        failed: result.metrics.failed,
        accuracy: result.metrics.accuracy,
        deflectionRate: result.metrics.deflectionRate,
        escalationPrecision: result.metrics.escalationPrecision,
        retrievalHitRate: result.metrics.retrievalHitRate,
        p95LatencyMs: result.metrics.p95LatencyMs,
        costPerConversationUsd: result.metrics.costPerConversationUsd?.toFixed(6) ?? null,
        hallucinationCount: result.metrics.hallucinationCount,
        citationMissCount: result.metrics.citationMissCount,
        meetsShipBar: result.meetsShipBar,
        shipBarNotes: result.shipBarNotes.join('; ') || null,
      })
      .returning({ id: schema.evalRuns.id });
    return row!.id;
  });
