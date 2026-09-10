/**
 * Reranker interface. Phase 1 ships the fusion-only implementation, which is a
 * pass-through on the fused score; the LLM reranker lands in Phase 2 behind a
 * flag, and the choice is made on eval numbers.
 */
export interface RerankCandidate {
  id: string;
  text: string;
  score: number;
}

export interface Reranker {
  key: string;
  rerank(query: string, candidates: RerankCandidate[], topN: number): Promise<RerankCandidate[]>;
}

export const fusionReranker: Reranker = {
  key: 'fusion',
  async rerank(_query, candidates, topN) {
    return [...candidates].sort((a, b) => b.score - a.score).slice(0, topN);
  },
};

export const resolveReranker = (key: string): Reranker => {
  if (key === 'fusion') return fusionReranker;
  throw new Error(`Unknown reranker "${key}" — the LLM reranker lands in Phase 2`);
};
