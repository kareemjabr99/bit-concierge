import { describe, expect, it } from 'vitest';
import { blindIndex, contentHash, safeEqual } from '../src/index.ts';

describe('identifiers', () => {
  it('hashes content stably regardless of incidental whitespace', () => {
    expect(contentHash('Returns  within\n14 days ')).toBe(contentHash('Returns within 14 days'));
  });

  it('changes the hash when the content changes', () => {
    expect(contentHash('within 14 days')).not.toBe(contentHash('within 3 days'));
  });

  it('blind-indexes case- and space-insensitively, but salt-dependently', () => {
    expect(blindIndex(' Ahmed@Example.com ', 's1')).toBe(blindIndex('ahmed@example.com', 's1'));
    expect(blindIndex('ahmed@example.com', 's1')).not.toBe(blindIndex('ahmed@example.com', 's2'));
  });

  it('compares equal and unequal strings without throwing on length mismatch', () => {
    expect(safeEqual('ahmed@example.com', 'ahmed@example.com')).toBe(true);
    expect(safeEqual('ahmed@example.com', 'other@example.com')).toBe(false);
    expect(safeEqual('short', 'much longer string')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
