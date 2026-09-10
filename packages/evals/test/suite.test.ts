import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listBaselines, diffRuns, metricsFor, shipBar, suiteFile, tierOf } from '../src/index.ts';
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
