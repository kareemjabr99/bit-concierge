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

/** A distinct, deterministic vector per text, so a reorder is visible. */
const vectorFor = (text: string): number[] => {
  const seed = [...text].reduce((n, c) => n + c.charCodeAt(0), 1);
  return Array.from({ length: spec.dims }, (_, i) => Math.sin(seed * (i + 1)));
};
/** First component after L2 normalisation, for comparing without exporting it. */
const l2first = (v: number[]): number => {
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
  return v[0]! / norm;
};

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
      doEmbed: async ({ values }: { values: string[] }) => ({
        embeddings: values.map(() => vector(1)),
      }),
    } as never);
    expect(await embedder.embedDocuments(['a', 'b', 'c'])).toHaveLength(3);
  });

  it('detects a provider returning the right count in the WRONG order', async () => {
    // The limit that was open until now. Nothing else in the system could see
    // this: an embedding carries nothing identifying, so a vector cannot be
    // checked against the text it describes. Every chunk would be stored
    // against someone else's vector, and the citation gate would PASS the
    // result because the chunk id resolves to a real document.
    //
    // What CAN be checked is that identical text embedded twice in one call
    // comes back identical — so the batch carries a canary at each end.
    let call = 0;
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'rotating',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async ({ values }: { values: string[] }) => {
        call += 1;
        // Correct vectors, rotated by one. Right count, wrong order.
        const correct = values.map((v) => vectorFor(v));
        return { embeddings: [...correct.slice(1), correct[0]!] };
      },
    } as never);

    await expect(embedder.embedDocuments(['a', 'b', 'c'])).rejects.toThrow(
      /embedded twice in one call disagreed|out of order/,
    );
    expect(call).toBe(1);
  });

  it('passes when the provider preserves order, and strips the canaries', async () => {
    // The control. Without it the check above could be "always throw", and the
    // caller must get back exactly its own texts — not the probes.
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'honest',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async ({ values }: { values: string[] }) => ({
        embeddings: values.map((v) => vectorFor(v)),
      }),
    } as never);

    const out = await embedder.embedDocuments(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    // Each returned vector is the one for its own text, canaries removed.
    for (const [i, text] of ['a', 'b', 'c'].entries()) {
      expect(out[i]![0]).toBeCloseTo(l2first(vectorFor(text)), 6);
    }
  });

  it('is tight enough to catch a swap between two SIMILAR passages', async () => {
    // The threshold has to be near 1, not merely "high". Two related store
    // passages embed close together — the two shipping policies on this corpus
    // are near-duplicates — so a transposition between them produces vectors
    // that are 0.9-ish similar and utterly wrong to serve.
    //
    // Identical text must give an identical vector, so anything below 1 is a
    // disagreement. This pins that: a canary pair 0.9 apart must still fail.
    const base = Array.from({ length: spec.dims }, (_, i) => Math.sin(i + 1));
    const nudged = base.map((x, i) => x + (i < spec.dims * 0.1 ? 0.6 : 0));
    let call = 0;
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'similar',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async ({ values }: { values: string[] }) => {
        call += 1;
        // Canary positions 0 and 1 get SIMILAR but not identical vectors.
        return {
          embeddings: values.map((_, i) => (i === 1 ? nudged : base)),
        };
      },
    } as never);

    await expect(embedder.embedDocuments(['a', 'b', 'c'])).rejects.toThrow(/out of order/);
    expect(call).toBe(1);
  });

  it('catches a reversal, which an end-to-end canary would miss', async () => {
    const embedder = makeEmbedder(spec, {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'reversing',
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: async ({ values }: { values: string[] }) => ({
        embeddings: values.map((v) => vectorFor(v)).reverse(),
      }),
    } as never);
    // The first design placed one canary at each end, which a reversal maps
    // onto each other: both ends still hold a canary, the check agrees, and
    // every chunk between them is silently transposed. This test is why the
    // probes are at 0, 1 and last instead.
    await expect(embedder.embedDocuments(['a', 'b', 'c'])).rejects.toThrow(/out of order/);
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
