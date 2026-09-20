import { embed, embedMany, type EmbeddingModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { BitcError } from '@bitc/core';

export interface EmbeddingModelSpec {
  /** e.g. "google:gemini-embedding-001@1536" — dimensions are part of the key. */
  key: string;
  provider: 'google';
  modelId: string;
  dims: number;
  /** Where vectors of this family live. See docs/adr/0004-embeddings.md. */
  table: 'chunk_embeddings';
  column: 'embedding';
  opclass: 'vector_cosine_ops';
  /** Provider input cap in tokens. Bounds chunk size upstream. */
  maxInputTokens: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  'google:gemini-embedding-001@1536': {
    key: 'google:gemini-embedding-001@1536',
    provider: 'google',
    modelId: 'gemini-embedding-001',
    dims: 1536,
    table: 'chunk_embeddings',
    column: 'embedding',
    opclass: 'vector_cosine_ops',
    maxInputTokens: 2048,
  },
};

export interface Embedder {
  spec: EmbeddingModelSpec;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const l2normalize = (v: number[]): number[] => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
};

const assertDims = (spec: EmbeddingModelSpec, vector: number[]): void => {
  if (vector.length !== spec.dims) {
    throw new BitcError(
      'embedding_dims_mismatch',
      `Expected ${spec.dims} dims, got ${vector.length}`,
      {
        context: { key: spec.key },
      },
    );
  }
};

/**
 * The ordering probe's text. Deliberately unlike any store content, so that if
 * it ever leaked into an index it would be obvious rather than plausible.
 */
const CANARY = 'bitc ordering probe — not store content — 7f3a1c';

/**
 * How close two embeddings of identical text must be.
 *
 * Identical input should give an identical vector, so the honest threshold is
 * 1. Slightly below it to tolerate floating-point drift through
 * normalisation — and only that, because anything further is a real
 * disagreement.
 */
const CANARY_AGREEMENT = 0.9999;

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
};

/** Wraps an AI SDK embedding model with task-typed calls and a dims assertion. */
export const makeEmbedder = (spec: EmbeddingModelSpec, model: EmbeddingModel): Embedder => ({
  spec,
  async embedDocuments(texts) {
    if (texts.length === 0) return [];
    // Two copies of the same text, at the two ends of the batch.
    //
    // Nothing else in the system can detect a provider returning the right
    // number of vectors in the wrong ORDER, and that failure is the worst
    // available: callers zip results onto rows by index, so every chunk would
    // be stored against someone else's vector, retrieval would return
    // confidently wrong passages, and the citation gate would PASS them
    // because the chunk id resolves to a real document. Grounded, cited, and
    // about a different policy.
    //
    // An embedding carries nothing identifying, so a vector cannot be checked
    // against the text it describes. What CAN be checked is that identical
    // text embedded twice in one call comes back identical. Under correct
    // ordering the two ends agree; under any reordering that moves either of
    // them they hold two different chunks' vectors and disagree enormously.
    //
    // The obvious design — embed a canary separately and look it up — cannot
    // work: a batch of one cannot be misordered, so it would pass while every
    // real batch was scrambled. Ordering is a property of a batch, so the
    // probe has to be inside the batch. See docs/embedding-order.md.
    // Placed at 0, 1 and last — asymmetric ON PURPOSE.
    //
    // The first design put one at each end, which a REVERSAL maps onto each
    // other: both ends still hold a canary vector, the check agrees, and every
    // chunk between them is silently transposed. Caught by writing a test for
    // reversal rather than by reasoning about it.
    //
    // Adjacent probes at 0 and 1 cannot survive a reversal or a rotation
    // together, and the one at the end covers a corruption confined to the
    // tail, which probes at the front would never see.
    const probed = [CANARY, CANARY, ...texts, CANARY];

    const { embeddings } = await embedMany({
      model,
      values: probed,
      maxParallelCalls: 2,
      providerOptions: {
        google: { outputDimensionality: spec.dims, taskType: 'RETRIEVAL_DOCUMENT' },
      },
    });

    // A provider that returns fewer vectors than it was given inputs is
    // reporting a failure inside a successful response, and this one is the
    // most dangerous shape of it in the codebase: callers zip the result back
    // onto their rows by index, so a gap does not drop a chunk — it shifts
    // every chunk after it onto the wrong vector.
    //
    // Retrieval would then return confidently wrong passages, and the citation
    // gate would PASS them, because the chunk id resolves to a real document.
    // Contamination indistinguishable from correct grounding. Fail loudly.
    if (embeddings.length !== probed.length) {
      throw new BitcError(
        'embedding_count_mismatch',
        `asked for ${probed.length} embeddings and got ${embeddings.length}`,
        { customerSafe: false },
      );
    }

    const probes = [0, 1, embeddings.length - 1].map((i) => l2normalize(embeddings[i]!));
    const agreement = Math.min(cosine(probes[0]!, probes[1]!), cosine(probes[0]!, probes[2]!));
    if (agreement < CANARY_AGREEMENT) {
      // Fail the ingest. There is no repairing this from here — the check
      // detects THAT ordering broke, never what the correct mapping was.
      throw new BitcError(
        'embedding_order_mismatch',
        `the same text embedded twice in one call disagreed (cosine ${agreement.toFixed(4)}). ` +
          `The provider returned vectors out of order; nothing downstream could detect this.`,
        { customerSafe: false },
      );
    }

    return embeddings.slice(2, -1).map((e) => {
      assertDims(spec, e);
      return l2normalize(e);
    });
  },
  async embedQuery(text) {
    const { embedding } = await embed({
      model,
      value: text,
      providerOptions: { google: { outputDimensionality: spec.dims, taskType: 'RETRIEVAL_QUERY' } },
    });
    assertDims(spec, embedding);
    return l2normalize(embedding);
  },
});

export const resolveEmbedder = (key: string, credentials: { googleApiKey?: string }): Embedder => {
  const spec = EMBEDDING_MODELS[key];
  if (!spec)
    throw new BitcError('model_unknown', `Unknown embedding model key "${key}"`, {
      context: { key },
    });
  if (!credentials.googleApiKey)
    throw new BitcError('model_credentials', 'Google API key is not configured');
  const google = createGoogleGenerativeAI({ apiKey: credentials.googleApiKey });
  return makeEmbedder(spec, google.embedding(spec.modelId));
};
