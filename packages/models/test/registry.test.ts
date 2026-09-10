import { describe, expect, it } from 'vitest';
import {
  CHAT_MODELS,
  EMBEDDING_MODELS,
  PRICING,
  estimateCostUsd,
  resolveChatModel,
  resolveReranker,
} from '../src/index.ts';

describe('model registry', () => {
  it('resolves a Google model from a key without exposing the provider', () => {
    const h = resolveChatModel('google:gemini-3.8-flash', { googleApiKey: 'test-key' });
    expect(h.spec.provider).toBe('google');
    expect((h.model as { modelId: string }).modelId).toBe('gemini-3.8-flash');
  });

  it('resolves an Anthropic model the same way — the abstraction is real', () => {
    const h = resolveChatModel('anthropic:claude-sonnet-5', { anthropicApiKey: 'test-key' });
    expect((h.model as { modelId: string }).modelId).toBe('claude-sonnet-5');
  });

  it('refuses an unknown key and a missing credential', () => {
    expect(() => resolveChatModel('openai:gpt', {})).toThrow(/Unknown chat model/);
    expect(() => resolveChatModel('google:gemini-3.8-flash', {})).toThrow(/not configured/);
  });

  it('has a pricing row for every registered model, even if unpriced', () => {
    for (const key of [...Object.keys(CHAT_MODELS), ...Object.keys(EMBEDDING_MODELS)]) {
      expect(key in PRICING, key).toBe(true);
    }
  });

  it('prices a known model and returns null for an unpriced one', () => {
    expect(
      estimateCostUsd('google:gemini-3.8-flash', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(0.75);
    expect(
      estimateCostUsd('google:gemini-3.1-pro-preview', { inputTokens: 10, outputTokens: 10 }),
    ).toBeNull();
  });

  it('keeps the embedding key and dimensions bound together', () => {
    const spec = EMBEDDING_MODELS['google:gemini-embedding-001@1536']!;
    expect(spec.dims).toBe(1536);
    expect(spec.key.endsWith(`@${spec.dims}`)).toBe(true);
  });

  it('only knows the fusion reranker until Phase 2', () => {
    expect(resolveReranker('fusion').key).toBe('fusion');
    expect(() => resolveReranker('cohere')).toThrow();
  });
});
