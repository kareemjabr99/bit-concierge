import { describe, expect, it } from 'vitest';
import { mockProducts, stockLevel, type ProductVariant } from '../src/index.ts';

/**
 * One value, decided here rather than by the agent.
 *
 * The agent used to be handed `available` and `inventoryQuantity` and left to
 * work out what "available, zero on hand" meant. It worked it out as in stock,
 * which is what Shopify means by available and is not what a customer means by
 * it: the item can be ordered and there is none of it.
 */

const variant = (over: Partial<ProductVariant>): ProductVariant => ({
  id: 'gid://shopify/ProductVariant/1',
  title: 'M',
  sku: 'X-1',
  price: { amount: '100.00', currencyCode: 'SAR' },
  available: true,
  inventoryQuantity: 10,
  inventoryPolicy: 'deny',
  selectedOptions: [],
  ...over,
});

describe('stock level', () => {
  it('bands a count rather than reporting it', () => {
    expect(stockLevel(variant({ inventoryQuantity: 40 }))).toBe('in_stock');
    expect(stockLevel(variant({ inventoryQuantity: 4 }))).toBe('in_stock');
    expect(stockLevel(variant({ inventoryQuantity: 3 }))).toBe('low');
    expect(stockLevel(variant({ inventoryQuantity: 1 }))).toBe('low');
  });

  it('separates zero-and-buyable from zero-and-not', () => {
    const zero = { inventoryQuantity: 0 };
    expect(stockLevel(variant({ ...zero, inventoryPolicy: 'continue' }))).toBe(
      'orderable_out_of_stock',
    );
    // DENY at zero: Shopify stops the sale, so availability is normally false
    // too. When the two disagree the policy wins, because the policy is the
    // half that holds at checkout — telling a customer to order something the
    // cart will refuse is worse than telling them it is gone.
    expect(stockLevel(variant({ ...zero, inventoryPolicy: 'deny' }))).toBe('out_of_stock');
    expect(stockLevel(variant({ ...zero, available: false, inventoryPolicy: 'continue' }))).toBe(
      'out_of_stock',
    );
  });

  it('lets unavailability veto a count', () => {
    // Archived or unpublished. Stock it has is stock nobody can buy.
    expect(stockLevel(variant({ available: false, inventoryQuantity: 50 }))).toBe('out_of_stock');
  });

  it('says unknown rather than guessing when nothing is tracked', () => {
    expect(stockLevel(variant({ inventoryQuantity: null }))).toBe('unknown');
    expect(stockLevel(variant({ inventoryQuantity: null, available: false }))).toBe('unknown');
  });

  it('reads the seeded store the way the scenarios were built', () => {
    const level = (handle: string, title: string) =>
      stockLevel(
        mockProducts.find((p) => p.handle === handle)!.variants.find((v) => v.title === title)!,
      );

    // The three states the store was seeded to hold, and the archived product.
    expect(level('classic-jacket-ss24', 'S')).toBe('orderable_out_of_stock');
    expect(level('classic-jacket-ss24', 'L')).toBe('out_of_stock');
    expect(level('sadu-hoodie', 'M')).toBe('low');
    expect(level('riyadh-oversized-tee', 'M')).toBe('in_stock');
    expect(level('1886-mask-black', 'Default Title')).toBe('out_of_stock');
  });
});
