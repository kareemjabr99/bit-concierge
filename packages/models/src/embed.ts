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

/** Wraps an AI SDK embedding model with task-typed calls and a dims assertion. */
export const makeEmbedder = (spec: EmbeddingModelSpec, model: EmbeddingModel): Embedder => ({
  spec,
  async embedDocuments(texts) {
    if (texts.length === 0) return [];
    const { embeddings } = await embedMany({
      model,
      values: texts,
      maxParallelCalls: 2,
      providerOptions: {
        google: { outputDimensionality: spec.dims, taskType: 'RETRIEVAL_DOCUMENT' },
      },
    });
    return embeddings.map((e) => {
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
