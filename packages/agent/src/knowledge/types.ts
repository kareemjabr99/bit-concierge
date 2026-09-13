import type { Language } from '@bitc/core';
import type { AdmissionPolicy } from '@bitc/models';

export interface KnowledgeHit {
  /** Stable chunk id — the thing a citation marker resolves to. */
  chunkId: string;
  content: string;
  title: string | null;
  url: string | null;
  headingPath: string[];
  /**
   * The reranker's verdict. NOT a calibrated probability — with the rubric
   * reranker it takes three values. Kept for reporting and diagnosis; the
   * admission decision is made by policy, not by comparing this to a
   * tenant-configured number. See docs/adr/0004-embeddings.md.
   */
  score: number;
}

export interface KnowledgeQuery {
  query: string;
  lang: Language;
  topK: number;
  /** Which of the reranker's verdicts count as retrieved. */
  admits: AdmissionPolicy;
}

/**
 * The retrieval contract. Phase 1 implements it over fixtures; Phase 2 over
 * chunk_embeddings with hybrid search. The tool and the gates see only this.
 */
export interface KnowledgeSearcher {
  search(query: KnowledgeQuery): Promise<KnowledgeHit[]>;
}

/**
 * Where an unanswerable question goes. Implemented over the database in
 * @bitc/rag; the agent only needs somewhere to put it, so the dependency
 * points one way — agent declares, rag implements.
 */
export interface GapRecorder {
  record(gap: { question: string; lang: Language; bestScore: number | null }): Promise<void>;
}
