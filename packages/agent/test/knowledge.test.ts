import { describe, expect, it } from 'vitest';
import { FixtureKnowledge } from '../src/index.ts';

const kb = new FixtureKnowledge();

describe('fixture knowledge', () => {
  it('finds the returns window and reports a calibrated score', async () => {
    const hits = await kb.search({
      query: 'can I return an item',
      lang: 'en',
      topK: 3,
      minScore: 0.2,
    });
    expect(hits[0]?.chunkId).toBe('fx-returns-window');
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeLessThanOrEqual(1);
    expect(hits[0]?.url).toContain('/policies/returns');
  });

  it('returns nothing for a question the corpus cannot answer', async () => {
    expect(
      await kb.search({ query: 'quantum cryptography', lang: 'en', topK: 3, minScore: 0.35 }),
    ).toEqual([]);
  });

  it('prefers the requested language and falls back when thin', async () => {
    const ar = await kb.search({ query: 'إرجاع', lang: 'ar', topK: 3, minScore: 0.2 });
    expect(ar[0]?.chunkId).toBe('fx-returns-window-ar');
    const fallback = await kb.search({
      query: 'care wash iron',
      lang: 'ar',
      topK: 3,
      minScore: 0.2,
    });
    expect(fallback.some((h) => h.chunkId === 'fx-care')).toBe(true);
  });
});
