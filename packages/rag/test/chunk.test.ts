import { describe, expect, it } from 'vitest';
import { chunk, estimateTokens, slugify } from '../src/index.ts';

describe('token estimate', () => {
  it('counts Arabic denser than Latin, and never returns zero for text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('سياسة الإرجاع')).toBeGreaterThan(estimateTokens('return policy') / 2);
  });
});

describe('chunking', () => {
  const doc = {
    title: 'Returns',
    url: 'https://example.test/policies/returns',
    content: [
      '## Window',
      'You may return an item within 7 days of delivery for a refund to the original payment method.',
      '## Exclusions',
      'Sale items and Archive Collection pieces cannot be returned or exchanged.',
    ].join('\n\n'),
  };

  it('splits on the document’s own headings and keeps the trail', () => {
    const chunks = chunk(doc);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.headingPath).toEqual(['Returns', 'Window']);
    expect(chunks[1]?.headingPath).toEqual(['Returns', 'Exclusions']);
  });

  it('gives every chunk an anchored URL so a reply can link to it', () => {
    expect(chunk(doc)[1]?.url).toBe('https://example.test/policies/returns#exclusions');
    expect(slugify('Returns & Exchanges Policy')).toBe('returns-exchanges-policy');
  });

  it('respects the ceiling, which is the provider’s input cap', () => {
    const long = {
      content: Array.from(
        { length: 60 },
        (_, i) => `Sentence number ${i} about shipping and delivery windows.`,
      ).join(' '),
    };
    for (const piece of chunk(long, { targetTokens: 60, maxTokens: 80 })) {
      expect(piece.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it('carries a sentence of overlap so a fact split across a boundary is findable', () => {
    const long = {
      content: Array.from(
        { length: 12 },
        (_, i) => `Fact ${i} is that returns take ${i} days to process.`,
      ).join(' '),
    };
    const chunks = chunk(long, { targetTokens: 40, maxTokens: 60, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    const tailOfFirst = chunks[0]!.content.split(/(?<=[.!?])\s+/).pop()!;
    expect(chunks[1]!.content).toContain(tailOfFirst);
  });

  it('folds a stub chunk into its neighbour rather than indexing it alone', () => {
    const chunks = chunk({
      content: '## A\n\nA reasonably long paragraph about shipping costs and delivery.\n\nShort.',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Short.');
  });

  it('returns nothing for an empty document rather than an empty chunk', () => {
    expect(chunk({ content: '   \n\n  ' })).toEqual([]);
  });
});
