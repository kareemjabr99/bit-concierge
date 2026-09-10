import { describe, expect, it } from 'vitest';
import { normaliseQuestion } from '../src/index.ts';

describe('knowledge gap grouping', () => {
  it('collapses phrasings of the same question', () => {
    expect(normaliseQuestion('How long is shipping?')).toBe(
      normaliseQuestion('shipping — how long???'),
    );
    expect(normaliseQuestion('Do you ship to Kuwait')).toBe(
      normaliseQuestion('do you ship to kuwait?'),
    );
  });

  it('keeps different questions apart', () => {
    expect(normaliseQuestion('do you ship to Kuwait')).not.toBe(
      normaliseQuestion('do you ship to Oman'),
    );
  });

  it('handles Arabic and strips diacritics', () => {
    expect(normaliseQuestion('هل تشحنون للكويت؟')).toBe(normaliseQuestion('تشحنون للكويت'));
    expect(normaliseQuestion('كَم يوماً للتوصيل')).toBe(normaliseQuestion('كم يوما للتوصيل'));
  });

  it('returns nothing for a question with no content words', () => {
    expect(normaliseQuestion('hi there')).toBe('');
  });
});
