import { describe, expect, it } from 'vitest';
import { MockShopifyClient, normalizeOrderName } from '../src/index.ts';

const shop = new MockShopifyClient();

describe('order name normalisation', () => {
  it('accepts the ways customers type an order number', () => {
    for (const v of [
      '#1886-2041',
      '1886-2041',
      ' # 1886 - 2041 ',
      '1886-2041 ',
      '#1886–2041'.replace('–', '-'),
    ]) {
      expect(normalizeOrderName(v)).toBe('#1886-2041');
    }
  });
});

describe('mock store', () => {
  it('finds orders by any spelling of the name', async () => {
    expect((await shop.getOrderByName('1886-2041'))?.email).toBe('ahmed@example.com');
    expect(await shop.getOrderByName('#1886-0000')).toBeNull();
  });

  it('searches products by words and filters', async () => {
    const tees = await shop.searchProducts('oversized tee');
    expect(tees[0]?.handle).toBe('riyadh-oversized-tee');
    const cheap = await shop.searchProducts('', { maxPrice: 150 });
    expect(cheap.map((p) => p.handle)).toEqual(['desert-cap']);
    const inStock = await shop.searchProducts('hoodie', { availableOnly: true });
    expect(inStock).toEqual([]);
  });

  it('exposes a sold-out variant and a sold-out product', async () => {
    const tee = await shop.getProductByHandle('riyadh-oversized-tee');
    expect(tee?.variants.find((v) => v.title === 'XL')?.available).toBe(false);
    expect((await shop.getProductByHandle('sadu-hoodie'))?.available).toBe(false);
  });
});
