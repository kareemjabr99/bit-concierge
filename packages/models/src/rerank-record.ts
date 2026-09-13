import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RerankCandidate, Reranker } from './rerank.ts';

/**
 * Records every verdict a reranker produces, for calibration analysis.
 *
 * The reranker's score is what admission gates on, so the shape of
 * its distribution decides whether that threshold is a calibrated decision or a
 * coin toss wearing a number. Twelve hand-picked questions cannot answer that;
 * the queries the agent actually generates across a full suite can.
 *
 * Wrapped OUTSIDE the cache so a cached verdict is recorded too — a cached
 * score is a real score, and excluding it would bias the distribution toward
 * whatever happened to be novel in this run.
 *
 * Harness-only. The agent resolves its reranker from the registry and never
 * sees this.
 */
export interface RerankRecord {
  /**
   * The eval case this search belongs to, when the harness supplies it.
   * Without it a score can only be attributed to a case by assuming two files
   * were written in the same order, which is an assumption that is true until
   * it quietly is not.
   */
  caseId?: string;
  query: string;
  /** Every candidate score this call produced, highest first. */
  scores: number[];
  /** Candidate ids, aligned with `scores`. */
  ids: string[];
  at: string;
}

export const recordingReranker = (
  inner: Reranker,
  path: string,
  /** Read at call time, so the harness can advance it per case. */
  currentCase?: () => string | undefined,
): Reranker => {
  mkdirSync(dirname(path), { recursive: true });
  return {
    key: inner.key,
    floors: inner.floors,
    ...(inner.stats ? { stats: inner.stats } : {}),
    async rerank(query, candidates, topN) {
      const ranked = await inner.rerank(query, candidates, topN);
      const caseId = currentCase?.();
      const record: RerankRecord = {
        ...(caseId ? { caseId } : {}),
        query,
        scores: ranked.map((c: RerankCandidate) => c.score),
        ids: ranked.map((c: RerankCandidate) => c.id),
        at: new Date().toISOString(),
      };
      appendFileSync(path, `${JSON.stringify(record)}\n`);
      return ranked;
    },
  };
};
