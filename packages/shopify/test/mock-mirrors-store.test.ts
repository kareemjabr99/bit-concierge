import { describe, expect, it } from 'vitest';
import { orders, products } from '../src/mock/fixtures.ts';
import {
  ASSIGNED_ORDER_NUMBERS,
  ORDERS,
  PRODUCTS,
  describeProduct,
  type SeedOrder,
} from '../scripts/seed-data.ts';

/**
 * The mock store and the development store hold the same rows.
 *
 * They diverged once, silently, and in the direction that matters. The mock
 * had made scenario 3 the guest order and reversed the two emails on scenario
 * 4, so the sixteen golden-set cases that turn on identity would have passed
 * against a mock that behaves differently from the store the acceptance run
 * uses. Nothing failed. Nothing could have: the suite only ever saw the mock.
 *
 * So the seed data is the source and this derives the fixtures from it. A
 * price changed in one place and not the other is now a red build rather than
 * a suppression that looks like a bug — the literal gate checks every number
 * in a reply against what the tools returned, and a mock that disagrees with
 * the store makes the gate correct and the answer useless.
 *
 * Four things are deliberately NOT mirrored, because each can only make the
 * mock a harsher test than the store, never a kinder one: ids (synthetic
 * gids), URLs (a reserved example domain, unfetchable), `createdAt` (seeding
 * time is not order time) and the absence of tax and shipping lines.
 */

const variantPrice = (sku: string): number => {
  const v = PRODUCTS.flatMap((p) => p.variants).find((x) => x.sku === sku);
  if (!v) throw new Error(`no seeded variant ${sku}`);
  return Number(v.price);
};

const productOf = (sku: string) => PRODUCTS.find((p) => p.variants.some((v) => v.sku === sku))!;

/** What a seeded order looks like once the store has applied the scenario. */
const expectedOrder = (o: SeedOrder) => ({
  name: ASSIGNED_ORDER_NUMBERS[o.key],
  email: o.orderEmail,
  customerEmail: o.customerEmail,
  financialStatus: o.cancel ? 'refunded' : o.refundSku ? 'partially_refunded' : 'paid',
  fulfillmentStatus: o.fulfil ? 'fulfilled' : 'unfulfilled',
  cancelled: o.cancel,
  city: o.city,
  fulfillments: o.fulfil
    ? [
        {
          status: o.fulfil.delivered ? 'delivered' : 'in_transit',
          trackingCompany: o.fulfil.company,
          trackingNumber: o.fulfil.trackingNumber,
          trackingUrl: o.fulfil.url,
        },
      ]
    : [],
  lineItems: o.lines.map((l) => ({
    title: productOf(l.sku).title,
    variantTitle: productOf(l.sku).variants.find((v) => v.sku === l.sku)!.option,
    sku: l.sku,
    quantity: l.quantity,
  })),
  total: o.lines.reduce((sum, l) => sum + variantPrice(l.sku) * l.quantity, 0).toFixed(2),
});

describe('the mock catalogue mirrors the seeded store', () => {
  it('holds every seeded product and no others', () => {
    expect(products.map((p) => p.handle).sort()).toEqual(PRODUCTS.map((p) => p.handle).sort());
  });

  it.each(PRODUCTS.map((p) => [p.handle, p] as const))('%s', (handle, seeded) => {
    const mock = products.find((p) => p.handle === handle)!;
    expect(mock.title).toBe(seeded.title);
    expect(mock.productType).toBe(seeded.productType);
    // Including the size chart, which is how the store holds it.
    expect(mock.description).toBe(describeProduct(seeded));

    expect(mock.variants.map((v) => v.sku)).toEqual(seeded.variants.map((v) => v.sku));
    seeded.variants.forEach((sv, i) => {
      const mv = mock.variants[i]!;
      expect(mv.title).toBe(sv.option);
      expect(mv.price.amount).toBe(sv.price);
      expect(mv.price.currencyCode).toBe('SAR');
      expect(mv.inventoryQuantity).toBe(sv.quantity);
      expect(mv.inventoryPolicy).toBe(sv.policy.toLowerCase());
      // The one that is easy to get wrong by hand, and the reason stock is a
      // tool call: zero on hand still sells when the policy says CONTINUE.
      const sellable =
        seeded.status !== 'ARCHIVED' && (sv.quantity > 0 || sv.policy === 'CONTINUE');
      expect(mv.available, `${sv.sku} qty ${sv.quantity} policy ${sv.policy}`).toBe(sellable);
    });

    expect(mock.available).toBe(mock.variants.some((v) => v.available));
    const prices = seeded.variants.map((v) => Number(v.price));
    expect(mock.priceRange.min.amount).toBe(Math.min(...prices).toFixed(2));
    expect(mock.priceRange.max.amount).toBe(Math.max(...prices).toFixed(2));
  });

  it('carries the archived product, unpurchasable rather than absent', () => {
    // A customer can still ask about something they already own.
    const archived = PRODUCTS.filter((p) => p.status === 'ARCHIVED').map((p) => p.handle);
    expect(archived.length).toBeGreaterThan(0);
    for (const handle of archived) {
      expect(products.find((p) => p.handle === handle)?.available).toBe(false);
    }
  });
});

describe('the mock orders mirror the seeded store', () => {
  it('holds every seeded order under the number the store assigned', () => {
    expect(orders.map((o) => o.name).sort()).toEqual(
      ORDERS.map((o) => ASSIGNED_ORDER_NUMBERS[o.key]).sort(),
    );
  });

  it.each(ORDERS.map((o) => [o.scenario, o] as const))('%s', (_scenario, seeded) => {
    const want = expectedOrder(seeded);
    const mock = orders.find((o) => o.name === want.name)!;
    expect(mock).toBeDefined();

    expect(mock.email).toBe(want.email);
    // Null here is a guest checkout, which is not the same as an account whose
    // address happens to match the order's.
    expect(mock.customerEmail).toBe(want.customerEmail);
    expect(mock.financialStatus).toBe(want.financialStatus);
    expect(mock.fulfillmentStatus).toBe(want.fulfillmentStatus);
    expect(mock.cancelledAt === null).toBe(!want.cancelled);
    expect(mock.shippingCity).toBe(want.city);
    expect(mock.shippingCountryCode).toBe('SA');
    expect(mock.lineItems).toEqual(want.lineItems);
    expect(mock.totalPrice.amount).toBe(want.total);
    expect(mock.totalPrice.currencyCode).toBe('SAR');
    expect(
      mock.fulfillments.map((f) => ({
        status: f.status,
        trackingCompany: f.trackingCompany,
        trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl,
      })),
    ).toEqual(want.fulfillments);
  });

  it('keeps the two scenarios that are easy to get wrong by hand', () => {
    // Stated as themselves rather than left to the derivation above, because
    // both were wrong in the mock and a derivation can be edited to agree with
    // whatever it is checking.
    const different = orders.find((o) => o.name === '#1886-1004')!;
    expect(different.email).toBe('k@example.com');
    expect(different.customerEmail).toBe('omar@example.com');

    const guest = orders.find((o) => o.name === '#1886-1006')!;
    expect(guest.email).toBe('guest@example.com');
    expect(guest.customerEmail).toBeNull();
  });
});
