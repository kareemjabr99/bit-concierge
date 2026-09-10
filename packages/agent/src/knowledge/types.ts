import type { Language } from '@bitc/core';

export interface KnowledgeHit {
  /** Stable chunk id — the thing a citation marker resolves to. */
  chunkId: string;
  content: string;
  title: string | null;
  url: string | null;
  headingPath: string[];
  /** Calibrated 0–1. The tenant threshold applies to this. */
  score: number;
}

export interface KnowledgeQuery {
  query: string;
  lang: Language;
  topK: number;
  minScore: number;
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
