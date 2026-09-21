import { describe, expect, it } from 'vitest';
import {
  normalizeAmount,
  toOrder,
  toProduct,
  type OrderNode,
  type ProductNode,
} from '../src/index.ts';
import {
  ARCHIVED_MASK,
  CANCELLED_ORDER,
  DELIVERED_ORDER,
  GUEST_ORDER,
  JACKET,
  PARTIALLY_REFUNDED_ORDER,
  SHIPPED_ORDER,
} from './shapes.ts';

/**
 * The mapper, against responses the store actually sent.
 *
 * Written from recordings rather than from the documentation, because the
 * first draft was written from the documentation and was wrong three times.
 */

describe('money', () => {
  it('spells one number one way', () => {
    // Shopify sends "258.0" for an order total and "129.00" for the variant
    // price that makes it up. The literal gate compares a reply against tool
    // results, so two spellings of one number is a difference that has to die
    // here.
    expect(normalizeAmount('258.0')).toBe('258.00');
    expect(normalizeAmount('129.00')).toBe('129.00');
    expect(normalizeAmount('0.0')).toBe('0.00');
    expect(normalizeAmount('749')).toBe('749.00');
  });

  it('pads and never truncates', () => {
    // KWD and BHD are three-decimal currencies and are next door to this
    // merchant. Rounding one to look tidy would change the number.
    expect(normalizeAmount('12.345')).toBe('12.345');
  });

  it('refuses something that is not a number rather than coercing it', () => {
    expect(() => normalizeAmount('1,299.00')).toThrow(/unreadable amount/);
    expect(() => normalizeAmount('')).toThrow();
    expect(() => normalizeAmount('SAR 100')).toThrow();
  });
});

describe('orders, from recorded responses', () => {
  it('reads a shipped order as shipped, not in transit', () => {
    // The assumption that cost the mock its correctness: a fulfilment with
    // tracking and no carrier scan is FULFILLED.
    const order = toOrder(SHIPPED_ORDER);
    expect(order.fulfillments[0]?.status).toBe('shipped');
    expect(order.fulfillments[0]?.trackingNumber).toBe('SMSA1886204100');
    expect(order.fulfillments[0]?.trackingCompany).toBe('SMSA Express');
    expect(order.totalPrice).toEqual({ amount: '189.00', currencyCode: 'SAR' });
    expect(order.currentTotalPrice).toEqual({ amount: '189.00', currencyCode: 'SAR' });
  });

  it('reads a delivered order, and its default variant as null', () => {
    const order = toOrder(DELIVERED_ORDER);
    expect(order.fulfillments[0]?.status).toBe('delivered');
    expect(order.lineItems[0]).toEqual({
      title: 'TFMC Tote Bag',
      variantTitle: null,
      sku: 'TT-NAT-OS',
      quantity: 2,
      currentQuantity: 2,
    });
  });

  it('keeps both totals on a partial refund', () => {
    // "Why is my total different" has two numbers in the answer. An assistant
    // holding one of them will guess the other.
    const order = toOrder(PARTIALLY_REFUNDED_ORDER);
    expect(order.financialStatus).toBe('partially_refunded');
    expect(order.totalPrice.amount).toBe('344.00');
    expect(order.currentTotalPrice.amount).toBe('215.00');
    const refunded = order.lineItems.find((l) => l.sku === 'TT-NAT-OS');
    expect(refunded).toMatchObject({ quantity: 1, currentQuantity: 0 });
  });

  it('keeps the order email and the account email apart', () => {
    const order = toOrder(CANCELLED_ORDER);
    expect(order.email).toBe('k@example.com');
    expect(order.customerEmail).toBe('omar@example.com');
    expect(order.cancelledAt).not.toBeNull();
    expect(order.currentTotalPrice.amount).toBe('0.00');
  });

  it('reads a guest checkout as having no account at all', () => {
    const order = toOrder(GUEST_ORDER);
    expect(order.email).toBe('guest@example.com');
    expect(order.customerEmail).toBeNull();
  });
});

describe('states this build has no answer for', () => {
  const withFulfilmentStatus = (displayStatus: string): OrderNode => ({
    ...SHIPPED_ORDER,
    fulfillments: [{ ...SHIPPED_ORDER.fulfillments[0]!, displayStatus }],
  });

  it.each([
    'ATTEMPTED_DELIVERY',
    'CANCELED',
    'DELAYED',
    'NOT_DELIVERED',
    'READY_FOR_PICKUP',
    'LABEL_VOIDED',
  ])('hands over rather than describing %s', (status) => {
    // Every one of these either means something went wrong or requires the
    // customer to do something. "On its way" is worse than a person.
    expect(() => toOrder(withFulfilmentStatus(status))).toThrow(/no customer-facing answer/);
  });

  it.each(['AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED'])(
    'hands over rather than describing payment state %s',
    (status) => {
      // Money. This project does not guess about money.
      expect(() => toOrder({ ...SHIPPED_ORDER, displayFinancialStatus: status })).toThrow(
        /no customer-facing answer/,
      );
    },
  );

  it.each(['ON_HOLD', 'SCHEDULED', 'REQUEST_DECLINED', 'RESTOCKED'])(
    'hands over rather than describing order state %s',
    (status) => {
      expect(() => toOrder({ ...SHIPPED_ORDER, displayFulfillmentStatus: status })).toThrow(
        /no customer-facing answer/,
      );
    },
  );

  it('names the state it could not describe', () => {
    // The log has to say which value, or the next person has to reproduce it.
    expect(() => toOrder(withFulfilmentStatus('DELAYED'))).toThrow(/DELAYED/);
  });

  it('treats a missing status as unreadable rather than as a default', () => {
    expect(() => toOrder({ ...SHIPPED_ORDER, displayFinancialStatus: null })).toThrow();
    expect(() => toOrder(withFulfilmentStatus(''))).toThrow();
  });
});

describe('products, from recorded responses', () => {
  it('carries the inventory policy rather than inferring it', () => {
    const jacket = toProduct(JACKET);
    const small = jacket.variants.find((v) => v.title === 'S')!;
    const large = jacket.variants.find((v) => v.title === 'L')!;
    expect(small).toMatchObject({
      inventoryQuantity: 0,
      inventoryPolicy: 'continue',
      available: true,
    });
    expect(large).toMatchObject({
      inventoryQuantity: 0,
      inventoryPolicy: 'deny',
      available: false,
    });
  });

  it('takes the currency from the price range, because a variant price has none', () => {
    const jacket = toProduct(JACKET);
    expect(jacket.variants[0]?.price).toEqual({ amount: '749.00', currencyCode: 'SAR' });
    expect(jacket.priceRange.min).toEqual({ amount: '749.00', currencyCode: 'SAR' });
  });

  it('returns no URL rather than a constructed one', () => {
    // Nothing on the development store is published to the Online Store
    // channel, so Shopify says null. The agent is told never to write a URL a
    // tool did not return.
    expect(toProduct(JACKET).url).toBeNull();
  });

  it('keeps an archived product findable and unbuyable', () => {
    const mask = toProduct(ARCHIVED_MASK);
    expect(mask.title).toBe('1886 Mask');
    expect(mask.available).toBe(false);
    expect(mask.variants[0]?.available).toBe(false);
  });

  it('refuses an inventory policy it does not recognise', () => {
    const odd: ProductNode = {
      ...JACKET,
      variants: { nodes: [{ ...JACKET.variants.nodes[0]!, inventoryPolicy: 'SOMETHING_NEW' }] },
    };
    expect(() => toProduct(odd)).toThrow(/no customer-facing answer/);
  });
});
