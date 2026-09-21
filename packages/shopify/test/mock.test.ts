import { describe, expect, it } from 'vitest';
import { MockShopifyClient, normalizeOrderName } from '../src/index.ts';

const shop = new MockShopifyClient();

describe('order name normalisation', () => {
  it('accepts the ways customers type an order number', () => {
    for (const v of [
      '#1886-1001',
      '1886-1001',
      ' # 1886 - 1001 ',
      '1886-1001 ',
      '#1886–1001'.replace('–', '-'),
    ]) {
      expect(normalizeOrderName(v)).toBe('#1886-1001');
    }
  });
});

describe('mock store', () => {
  it('finds orders by any spelling of the name', async () => {
    expect((await shop.getOrderByName('1886-1001'))?.email).toBe('ahmed@example.com');
    expect(await shop.getOrderByName('#1886-0000')).toBeNull();
  });

  it('searches products by words and filters', async () => {
    const tees = await shop.searchProducts('oversized tee');
    expect(tees[0]?.handle).toBe('riyadh-oversized-tee');
    const cheap = await shop.searchProducts('', { maxPrice: 150 });
    expect(cheap.map((p) => p.handle)).toEqual(['tfmc-tote-bag', '1886-mask-black']);
    // The archived mask is findable by name and excluded by availability —
    // both halves matter, so both are asserted.
    expect((await shop.searchProducts('mask')).map((p) => p.handle)).toEqual(['1886-mask-black']);
    expect(await shop.searchProducts('mask', { availableOnly: true })).toEqual([]);
  });

  it('exposes a sold-out variant and a sold-out product', async () => {
    const jacket = await shop.getProductByHandle('classic-jacket-ss24');
    expect(jacket?.variants.find((v) => v.title === 'L')?.available).toBe(false);
    expect((await shop.getProductByHandle('1886-mask-black'))?.available).toBe(false);
  });

  it('exposes zero stock that is still purchasable', async () => {
    // The state that looks available and is not. S and L both hold nothing;
    // the merchant's continue-selling setting is the only difference, and it
    // is why "is it in stock" cannot be answered from the catalogue alone.
    const s = (await shop.getProductByHandle('classic-jacket-ss24'))?.variants.find(
      (v) => v.title === 'S',
    );
    expect(s?.inventoryQuantity).toBe(0);
    expect(s?.available).toBe(true);
  });
});
