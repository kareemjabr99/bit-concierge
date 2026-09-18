import { describe, expect, it } from 'vitest';
import { makeEmbedder } from '../src/embed.ts';
import { llmReranker } from '../src/rerank.ts';
import { EMBEDDING_MODELS } from '../src/embed.ts';

/**
 * Failure reported inside a successful response.
 *
 * Shopify does it — a throttle arrives as HTTP 200 with a GraphQL error — and
 * the audit that followed found the same shape twice more in code we own.
 * These are those two.
 */

const spec = EMBEDDING_MODELS['google:gemini-embedding-001@1536']!;
const vector = (fill: number) => Array.from({ length: spec.dims }, () => fill);

describe('an embedding provider that returns fewer vectors than inputs', () => {
  it('throws rather than returning a short array', async () => {
    // This one turned out to be guarded already: the AI SDK checks the count
    // itself and throws "Expected 3 embeddings, but received 2" before our
    // check runs. Recorded as a near-miss rather than a bug found, because
    // that is what it was.
    //
    // The check stays anyway. It is free, it states the invariant at the
    // boundary we own, and the consequence if it ever stopped holding is the
    // worst in the codebase: callers zip results onto rows BY INDEX, so a gap
    // does not drop a chunk, it shifts every chunk after it onto the wrong
    // vector. Retrieval would return confidently wrong passages and the
    // citation gate would PASS them, because the chunk id resolves to a real
    // document — contamination indistinguishable from correct grounding.
    //
    // Asserting the property rather than either message, because whose check
    // fires is not the point.
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'short',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async () => ({ embeddings: [vector(1), vector(2)] }),
    } as never);

    await expect(embedder.embedDocuments(['a', 'b', 'c'])).rejects.toThrow(/3|2/);
  });

  it('accepts a response that matches', async () => {
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'exact',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async () => ({ embeddings: [vector(1), vector(2), vector(3)] }),
    } as never);
    expect(await embedder.embedDocuments(['a', 'b', 'c'])).toHaveLength(3);
  });

  it('what NOBODY checks: that the vectors came back in the order asked', () => {
    // Neither the SDK nor this code can verify ordering — an embedding carries
    // nothing identifying, so a provider that returned the right count in the
    // wrong order would be undetectable here and would produce exactly the
    // contamination described above.
    //
    // Recorded as a known limit rather than left implicit. It is the
    // provider's contract, and this test exists so the assumption is written
    // down somewhere rather than only being relied upon.
    expect(true).toBe(true);
  });
});

describe('a reranker that scores only some of what it was shown', () => {
  const candidates = [
    { id: 'a', text: 'returns within 7 days', score: 0.7 },
    { id: 'b', text: 'shipping takes 1-10 days', score: 0.6 },
    { id: 'c', text: 'contact us', score: 0.5 },
  ];

  /** A model that returns a score for index 0 only. */
  const partial = {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'partial',
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ scores: [{ i: 0, relevance: 1 }] }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }),
  } as never;

  it('falls back to fusion instead of silently marking the rest irrelevant', async () => {
    // Defaulting the unscored to 0 reads as a confident judgement that they
    // are irrelevant, and `scored` would tick up as though the reranker had
    // worked. That is a measurement quietly becoming a different measurement —
    // the same failure as a silent fallback to cosine.
    const reranker = llmReranker(partial, 'llm:mock');
    const ranked = await reranker.rerank('returns', candidates, 3);

    expect(reranker.stats?.fellBack).toBe(1);
    expect(reranker.stats?.scored).toBe(0);
    // Fusion order keeps the incoming cosine scores; nothing was demoted to 0.
    expect(ranked.map((c) => c.score)).toEqual([0.7, 0.6, 0.5]);
  });
});
