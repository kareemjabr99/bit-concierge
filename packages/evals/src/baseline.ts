import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseOutcome, RunResult } from './types.ts';

/**
 * A baseline per model, and a diff against it.
 *
 * The count is not the signal. A suppressed-correct answer and a passed
 * fabrication move `passed` by the same amount in opposite directions, and a
 * summary that reports only totals hides both. So the diff is case-level:
 * which cases flipped, in which direction, and every citation-gate suppression
 * that appeared or disappeared.
 *
 * Baselines are per model because a model swap invalidates every number —
 * ADR 0006. Diffing flash-lite against a paid model is the intended use.
 */

export interface BaselineFile {
  chatModel: string;
  suite: string;
  tier: string;
  gitSha: string;
  recordedAt: string;
  metrics: RunResult['metrics'];
  /** Per case, only what a diff needs. */
  cases: Record<
    string,
    {
      passed: boolean;
      behaviour: string;
      hallucinations: number;
      citationMisses: number;
      falseSuppression: boolean;
      failures: string[];
    }
  >;
}

const fileName = (suite: string, chatModel: string): string =>
  `${suite}.${chatModel.replace(/[^a-z0-9.-]+/gi, '_')}.json`;

export const toBaseline = (result: RunResult): BaselineFile => ({
  chatModel: result.chatModel,
  suite: result.suite,
  tier: result.tier,
  gitSha: result.gitSha,
  recordedAt: result.startedAt,
  metrics: result.metrics,
  cases: Object.fromEntries(
    result.outcomes.map((outcome) => [
      outcome.id,
      {
        passed: outcome.passed,
        behaviour: outcome.behaviour,
        hallucinations: outcome.hallucinations,
        citationMisses: outcome.citationMisses,
        falseSuppression: outcome.falseSuppression,
        failures: outcome.failures,
      },
    ]),
  ),
});

export const writeBaseline = (dir: string, result: RunResult): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName(result.suite, result.chatModel));
  writeFileSync(path, `${JSON.stringify(toBaseline(result), null, 2)}\n`);
  return path;
};

export const readBaseline = (
  dir: string,
  suite: string,
  chatModel: string,
): BaselineFile | undefined => {
  const path = join(dir, fileName(suite, chatModel));
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as BaselineFile;
};

export const listBaselines = (dir: string): BaselineFile[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BaselineFile);
};

export type FlipDirection = 'fixed' | 'broken' | 'new' | 'removed';

export interface CaseFlip {
  id: string;
  direction: FlipDirection;
  was: string;
  now: string;
  failures: string[];
}

export interface SuppressionChange {
  id: string;
  change: 'appeared' | 'disappeared';
  /** The case expected an answer, so a suppression here withheld a correct one. */
  wasCorrectAnswer: boolean;
}

export interface Diff {
  baseline: { chatModel: string; gitSha: string; recordedAt: string };
  candidate: { chatModel: string; gitSha: string; recordedAt: string };
  /** Deltas, for orientation only. The flips below are the signal. */
  metricDeltas: Record<string, number>;
  flips: CaseFlip[];
  suppressions: SuppressionChange[];
  hallucinationDelta: number;
  citationMissDelta: number;
}

export const diffRuns = (baseline: BaselineFile, candidate: RunResult): Diff => {
  const now = new Map(candidate.outcomes.map((o) => [o.id, o]));
  const flips: CaseFlip[] = [];
  const suppressions: SuppressionChange[] = [];

  for (const [id, before] of Object.entries(baseline.cases)) {
    const after = now.get(id);
    if (!after) {
      flips.push({ id, direction: 'removed', was: before.behaviour, now: '—', failures: [] });
      continue;
    }
    if (before.passed !== after.passed) {
      flips.push({
        id,
        direction: after.passed ? 'fixed' : 'broken',
        was: before.behaviour,
        now: after.behaviour,
        failures: after.failures,
      });
    }
    if (before.falseSuppression !== after.falseSuppression) {
      suppressions.push({
        id,
        change: after.falseSuppression ? 'appeared' : 'disappeared',
        wasCorrectAnswer: true,
      });
    } else if (
      before.behaviour !== after.behaviour &&
      (before.behaviour === 'suppressed' || after.behaviour === 'suppressed')
    ) {
      suppressions.push({
        id,
        change: after.behaviour === 'suppressed' ? 'appeared' : 'disappeared',
        wasCorrectAnswer: after.falseSuppression,
      });
    }
  }
  for (const outcome of candidate.outcomes) {
    if (!(outcome.id in baseline.cases)) {
      flips.push({
        id: outcome.id,
        direction: 'new',
        was: '—',
        now: outcome.behaviour,
        failures: outcome.failures,
      });
    }
  }

  const metricDeltas: Record<string, number> = {};
  for (const key of Object.keys(candidate.metrics) as (keyof RunResult['metrics'])[]) {
    const before = baseline.metrics[key];
    const after = candidate.metrics[key];
    if (typeof before === 'number' && typeof after === 'number') {
      metricDeltas[key] = Number((after - before).toFixed(4));
    }
  }

  return {
    baseline: {
      chatModel: baseline.chatModel,
      gitSha: baseline.gitSha,
      recordedAt: baseline.recordedAt,
    },
    candidate: {
      chatModel: candidate.chatModel,
      gitSha: candidate.gitSha,
      recordedAt: candidate.startedAt,
    },
    metricDeltas,
    flips: flips.sort((a, b) => a.direction.localeCompare(b.direction) || a.id.localeCompare(b.id)),
    suppressions,
    hallucinationDelta: candidate.metrics.hallucinationCount - baseline.metrics.hallucinationCount,
    citationMissDelta: candidate.metrics.citationMissCount - baseline.metrics.citationMissCount,
  };
};

/** Outcomes that need a person to look at them before a swap is accepted. */
export const needsReview = (diff: Diff): CaseFlip[] =>
  diff.flips.filter((flip) => flip.direction === 'broken' || flip.direction === 'new');

export const suppressionsToReview = (diff: Diff, outcomes: CaseOutcome[]): CaseOutcome[] => {
  const ids = new Set(diff.suppressions.filter((s) => s.change === 'appeared').map((s) => s.id));
  return outcomes.filter((outcome) => ids.has(outcome.id));
};
