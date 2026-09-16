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
    const h = resolveChatModel('google:gemini-3.5-flash-lite', { googleApiKey: 'test-key' });
    expect(h.spec.provider).toBe('google');
    expect((h.model as { modelId: string }).modelId).toBe('gemini-3.5-flash-lite');
  });

  it('resolves an Anthropic model the same way — the abstraction is real', () => {
    const h = resolveChatModel('anthropic:claude-sonnet-5', { anthropicApiKey: 'test-key' });
    expect((h.model as { modelId: string }).modelId).toBe('claude-sonnet-5');
  });

  it('refuses an unknown key and a missing credential', () => {
    expect(() => resolveChatModel('openai:gpt', {})).toThrow(/Unknown chat model/);
    expect(() => resolveChatModel('google:gemini-3.5-flash-lite', {})).toThrow(/not configured/);
  });

  it('has a pricing row for every registered model, even if unpriced', () => {
    for (const key of [...Object.keys(CHAT_MODELS), ...Object.keys(EMBEDDING_MODELS)]) {
      expect(key in PRICING, key).toBe(true);
    }
  });

  it('prices a known model and returns null for an unpriced one', () => {
    expect(
      estimateCostUsd('google:gemini-embedding-001@1536', {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(0.15);
    // The chat model is priced at the PAID standard rate even though the
    // development key runs on the free tier. A licence has to be priced
    // against what it will cost, not against what a capped development key
    // happens to charge, and a zero would make every projection read as free.
    expect(
      estimateCostUsd('google:gemini-3.5-flash-lite', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(2.8);
    expect(
      estimateCostUsd('anthropic:claude-sonnet-5', { inputTokens: 10, outputTokens: 10 }),
    ).toBeNull();
  });

  it('records where every rate came from and when', () => {
    // A stale rate makes a licence wrong. An unchecked one makes it fiction.
    for (const [key, price] of Object.entries(PRICING)) {
      if (!price) continue;
      expect(price.checkedAt, `${key} has no checked date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps the embedding key and dimensions bound together', () => {
    const spec = EMBEDDING_MODELS['google:gemini-embedding-001@1536']!;
    expect(spec.dims).toBe(1536);
    expect(spec.key.endsWith(`@${spec.dims}`)).toBe(true);
  });

  it('does not register a model whose free quota cannot run the eval suite', () => {
    // gemini-3.8-flash is twenty free-tier requests a day. A registry entry is
    // an invitation to burn them; adding it back is the swap procedure.
    expect('google:gemini-3.8-flash' in CHAT_MODELS).toBe(false);
    expect(() => resolveChatModel('google:gemini-3.8-flash', { googleApiKey: 'k' })).toThrow(
      /Unknown chat model/,
    );
  });

  it('carries provider quota for the harness, not the loop', () => {
    expect(CHAT_MODELS['google:gemini-3.5-flash-lite']?.quota?.requestsPerMinute).toBeGreaterThan(
      0,
    );
  });

  it('only knows the fusion reranker until Phase 2', () => {
    expect(resolveReranker('fusion').key).toBe('fusion');
    expect(() => resolveReranker('cohere')).toThrow();
  });
});
