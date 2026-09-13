import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  listBaselines,
  diffRuns,
  metricsFor,
  shipBar,
  suiteFile,
  tierOf,
  validate as validateAdjudications,
  adjudicationFile,
} from '../src/index.ts';
import type { Adjudication } from '../src/index.ts';
import type { CaseOutcome, EvalCase, RunResult } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, '..', 'cases');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith('.json')
        ? [join(dir, entry.name)]
        : [],
  );

const allCases: EvalCase[] = files(CASES_DIR).flatMap(
  (file) => suiteFile.parse(JSON.parse(readFileSync(file, 'utf8'))).cases,
);

describe('golden set', () => {
  it('parses, and every case has a unique id', () => {
    expect(allCases.length).toBeGreaterThan(0);
    expect(new Set(allCases.map((c) => c.id)).size).toBe(allCases.length);
  });

  it('covers every category section 9 names', () => {
    const covered = new Set(allCases.map((c) => c.category));
    for (const required of [
      'returns',
      'shipping',
      'sizing',
      'order-status',
      'identity',
      'stock',
      'escalation',
      'abuse',
      'store-info',
      'unanswerable',
      'injection',
    ] as const) {
      expect(covered.has(required), `no case covers ${required}`).toBe(true);
    }
  });

  it('gives every case a reason to exist', () => {
    for (const c of allCases)
      expect(c.expect.notes.length, `${c.id} has no notes`).toBeGreaterThan(20);
  });

  it('is provisional until every case is signed', () => {
    // The tier is what the report and the ship bar key off. An unsigned set
    // must never read as validated.
    expect(tierOf(allCases)).toBe('provisional');
    expect(tierOf([{ ...allCases[0]!, validatedBy: 'CX lead' }])).toBe('validated');
  });
});

const outcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
  id: 'x',
  category: 'returns',
  lang: 'en',
  passed: true,
  failures: [],
  behaviour: 'answer',
  expectedBehaviour: 'answer',
  reply: 'ok',
  rawModelText: null,
  toolsCalled: [],
  citedSources: [],
  retrievedSources: [],
  hallucinations: 0,
  citationMisses: 0,
  falseSuppression: false,
  latencyMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: null,
  ...over,
});

describe('adjudication discipline', () => {
  const evidenced: Adjudication = {
    caseId: 'x',
    field: 'behaviour',
    originalBehaviour: 'answer',
    newBehaviour: 'escalate',
    originalValue: [],
    newValue: [],
    evidence: {
      kind: 'sources',
      sources: [
        { sourceId: 'policies/refund-policy', score: 0.5, excerpt: 'returns within 7 days' },
      ],
    },
    rationale:
      'The corpus states the window but says nothing about gift returns, so the original expectation that this was answerable is not supported by any retrieved chunk.',
    adjudicatedBy: 'reviewer',
    adjudicatedAt: '2026-09-13',
  };

  it('refuses a reclassification with no evidence in front of you', () => {
    expect(() =>
      adjudicationFile.parse({
        suite: 's',
        adjudications: [{ ...evidenced, evidence: { kind: 'sources', sources: [] } }],
      }),
    ).toThrow();
  });

  it('refuses an absence claim with no queries behind it', () => {
    expect(() =>
      adjudicationFile.parse({
        suite: 's',
        adjudications: [
          {
            ...evidenced,
            evidence: {
              kind: 'absence',
              queries: [],
              bestScore: 0,
              corpusSearch: { terms: ['gift wrap'], matchedChunks: 0 },
              alsoChecked: 'the live page',
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('refuses an absence claim contradicted by its own best score', () => {
    // "The corpus does not cover this" is not compatible with a candidate the
    // reranker called a direct answer.
    const problems = validateAdjudications([
      {
        ...evidenced,
        evidence: {
          kind: 'absence',
          queries: ['tracking portal'],
          bestScore: 1,
          corpusSearch: { terms: ['tracking number'], matchedChunks: 0 },
          alsoChecked: 'the crawl notes in docs/corpus-findings.md',
        },
      },
    ]);
    expect(problems.join(' ')).toContain('not an absence');
  });

  it('accepts an absence recorded with the queries that found nothing', () => {
    expect(
      validateAdjudications([
        {
          ...evidenced,
          evidence: {
            kind: 'absence',
            queries: ['gift wrapping', 'gift wrap at checkout'],
            bestScore: 0.5,
            corpusSearch: { terms: ['gift wrap'], matchedChunks: 0 },
            alsoChecked: 'the live page, and the crawl notes in docs/corpus-findings.md',
          },
        },
      ]),
    ).toEqual([]);
  });

  it('refuses an absence the corpus text contradicts', () => {
    // The mistake this field was added for. An absence was recorded for
    // order-tracking instructions because retrieval scored them 0.5 and the
    // threshold excluded them. The corpus has them, on two pages, disagreeing
    // with each other. A substring search does not care what the reranker
    // thought, which is why it is the check.
    const problems = validateAdjudications([
      {
        ...evidenced,
        evidence: {
          kind: 'absence',
          queries: ['track order shipping tracking'],
          bestScore: 0.5,
          corpusSearch: { terms: ['tracking number'], matchedChunks: 4 },
          alsoChecked: 'the crawl notes in docs/corpus-findings.md',
        },
      },
    ]);
    expect(problems.join(' ')).toContain('Retrieval missing it is not the corpus lacking it');
  });

  it('refuses one that records no change', () => {
    expect(validateAdjudications([{ ...evidenced, newBehaviour: 'answer' }]).join(' ')).toContain(
      'records no change',
    );
  });

  it('refuses a content-expectation change that changes nothing', () => {
    expect(
      validateAdjudications([
        {
          ...evidenced,
          field: 'mustNotContain',
          originalValue: ['free return'],
          newValue: ['free return'],
        },
      ]).join(' '),
    ).toContain('records no change to mustNotContain');
  });

  it('refuses the same case and field adjudicated twice', () => {
    expect(validateAdjudications([evidenced, evidenced]).join(' ')).toContain('adjudicated twice');
  });

  it('demands a real rationale, not a word', () => {
    expect(() =>
      adjudicationFile.parse({ suite: 's', adjudications: [{ ...evidenced, rationale: 'wrong' }] }),
    ).toThrow();
  });

  it('accepts one that carries its evidence', () => {
    expect(validateAdjudications([evidenced])).toEqual([]);
  });

  it('reports both scores, and the original counts an adjudicated pass as a failure', () => {
    const outcomes = [
      outcome({ id: 'a' }),
      outcome({ id: 'b' }),
      outcome({ id: 'c', passed: false }),
    ];
    const plain = metricsFor(outcomes);
    const adjudicated = metricsFor(outcomes, [{ ...evidenced, caseId: 'b' }]);

    expect(plain.accuracy).toBeCloseTo(2 / 3);
    expect(plain.accuracyAsOriginallyScored).toBeCloseTo(2 / 3);
    // 'b' now passes only because its expectation was rewritten.
    expect(adjudicated.accuracy).toBeCloseTo(2 / 3);
    expect(adjudicated.accuracyAsOriginallyScored).toBeCloseTo(1 / 3);
    expect(adjudicated.adjudicatedCases).toBe(1);
  });

  it('judges the ship bar on the original score, never the adjudicated one', () => {
    // Ten cases, nine passing only because they were reclassified.
    const outcomes = Array.from({ length: 10 }, (_, i) => outcome({ id: `c${i}` }));
    const adjudications = outcomes.slice(0, 9).map((o) => ({ ...evidenced, caseId: o.id }));
    const metrics = metricsFor(outcomes, adjudications);
    expect(metrics.accuracy).toBe(1);
    const bar = shipBar(
      {
        suite: 's',
        tier: 'validated',
        gitSha: 'a',
        chatModel: 'google:m',
        embeddingModel: 'e',
        reranker: 'fusion',
        startedAt: '',
        metrics,
        outcomes,
      },
      'google:m',
    );
    expect(bar.meets).toBe(false);
    expect(bar.notes.join(' ')).toContain('as originally scored');
  });
});

describe('the recorded adjudications.json on disk', () => {
  it('parses, and every entry carries the evidence that forced it', () => {
    const path = join(HERE, '..', 'adjudications.json');
    // Not skipped when absent. A check that disappears with the file it checks
    // is a check that can be removed by deleting evidence, which is the exact
    // move this suite exists to prevent.
    expect(existsSync(path), 'adjudications.json is committed and must be present').toBe(true);
    const parsed = adjudicationFile.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(validateAdjudications(parsed.adjudications)).toEqual([]);
    for (const a of parsed.adjudications) {
      const carries =
        a.evidence.kind === 'sources'
          ? a.evidence.sources.length > 0
          : a.evidence.queries.length > 0;
      expect(carries, `${a.caseId} carries no evidence`).toBe(true);
      expect(a.rationale.length, `${a.caseId} rationale is too thin`).toBeGreaterThan(60);
    }
  });
});

describe('ship bar', () => {
  const base = (
    over: Partial<RunResult> = {},
  ): Omit<RunResult, 'meetsShipBar' | 'shipBarNotes'> => {
    const outcomes = over.outcomes ?? [outcome(), outcome()];
    return {
      suite: 's',
      tier: 'validated',
      gitSha: 'abc',
      chatModel: 'google:m',
      embeddingModel: 'e',
      reranker: 'fusion',
      startedAt: '',
      metrics: metricsFor(outcomes),
      outcomes,
      ...over,
    };
  };

  it('passes a clean validated run on the production model', () => {
    expect(shipBar(base(), 'google:m').meets).toBe(true);
  });

  it('fails closed when the run was measured on a different model', () => {
    const bar = shipBar(base(), 'google:production');
    expect(bar.meets).toBe(false);
    expect(bar.notes.join(' ')).toContain('different system');
  });

  it('fails on a provisional suite however good the numbers', () => {
    expect(shipBar(base({ tier: 'provisional' }), 'google:m').meets).toBe(false);
  });

  it('treats one fabricated literal as pass/fail', () => {
    const outcomes = [outcome(), outcome({ hallucinations: 1 })];
    expect(shipBar(base({ outcomes }), 'google:m').meets).toBe(false);
  });

  it('treats one uncited policy claim as pass/fail', () => {
    const outcomes = [outcome(), outcome({ citationMisses: 1 })];
    expect(shipBar(base({ outcomes }), 'google:m').meets).toBe(false);
  });
});

describe('model diff', () => {
  const asResult = (outcomes: CaseOutcome[]): RunResult => ({
    suite: 's',
    tier: 'provisional',
    gitSha: 'new',
    chatModel: 'google:new',
    embeddingModel: 'e',
    reranker: 'fusion',
    startedAt: '2026-09-11T00:00:00Z',
    metrics: metricsFor(outcomes),
    outcomes,
    meetsShipBar: false,
    shipBarNotes: [],
  });

  const baseline = {
    chatModel: 'google:old',
    suite: 's',
    tier: 'provisional',
    gitSha: 'old',
    recordedAt: '2026-09-10T00:00:00Z',
    metrics: metricsFor([
      outcome({ id: 'a' }),
      outcome({ id: 'b' }),
      outcome({ id: 'c', passed: false }),
    ]),
    cases: {
      a: {
        passed: true,
        behaviour: 'answer',
        hallucinations: 0,
        citationMisses: 0,
        falseSuppression: false,
        failures: [],
      },
      b: {
        passed: true,
        behaviour: 'answer',
        hallucinations: 0,
        citationMisses: 0,
        falseSuppression: false,
        failures: [],
      },
      c: {
        passed: false,
        behaviour: 'escalate',
        hallucinations: 0,
        citationMisses: 0,
        falseSuppression: false,
        failures: ['x'],
      },
    },
  };

  it('names the cases that flipped, in both directions', () => {
    const diff = diffRuns(
      baseline,
      asResult([
        outcome({ id: 'a' }),
        outcome({
          id: 'b',
          passed: false,
          behaviour: 'suppressed',
          falseSuppression: true,
          failures: ['withheld'],
        }),
        outcome({ id: 'c' }),
      ]),
    );
    expect(diff.flips.find((f) => f.id === 'b')?.direction).toBe('broken');
    expect(diff.flips.find((f) => f.id === 'c')?.direction).toBe('fixed');
    expect(diff.flips.find((f) => f.id === 'a')).toBeUndefined();
  });

  it('reports a new suppression that withheld a correct answer', () => {
    const diff = diffRuns(
      baseline,
      asResult([
        outcome({ id: 'a' }),
        outcome({ id: 'b', passed: false, behaviour: 'suppressed', falseSuppression: true }),
        outcome({ id: 'c', passed: false }),
      ]),
    );
    const change = diff.suppressions.find((s) => s.id === 'b');
    expect(change).toMatchObject({ change: 'appeared', wasCorrectAnswer: true });
  });

  it('does not hide an equal trade behind a flat pass count', () => {
    // One case fixed, one broken: `passed` is unchanged and both are named.
    const diff = diffRuns(
      baseline,
      asResult([outcome({ id: 'a' }), outcome({ id: 'b', passed: false }), outcome({ id: 'c' })]),
    );
    expect(diff.metricDeltas.passed ?? 0).toBe(0);
    expect(diff.flips.map((f) => f.direction).sort()).toEqual(['broken', 'fixed']);
  });

  it('reads the recorded baselines on disk', () => {
    const recorded = listBaselines(join(HERE, '..', 'baselines'));
    for (const file of recorded) {
      expect(file.chatModel).toMatch(/^[a-z]+:/);
      expect(Object.keys(file.cases).length).toBeGreaterThan(0);
    }
  });
});
