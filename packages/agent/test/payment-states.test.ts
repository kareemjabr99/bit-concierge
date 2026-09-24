import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect } from '@bitc/db';
import type { TenantId } from '@bitc/core';
import { MockShopifyClient, mockOrders, mockProducts, type Order } from '@bitc/shopify';
import { runTurn, systemMessage } from '../src/index.ts';
import {
  depsWith,
  dropTenant,
  prepareDatabase,
  scripted,
  seedTestTenant,
  uniqueId,
} from './helpers.ts';

/**
 * Two payment states, each with a decided answer.
 *
 * AUTHORIZED: a card hold nobody has captured. The order is confirmed, so a
 * status question is answered from fulfilment and says nothing about payment.
 * The customer sees a pending charge, so "paid" is false and "pending" is a
 * money claim — a payment question goes to the team.
 *
 * PARTIALLY_PAID: money is owed. Always the merchant's conversation, whatever
 * was asked.
 *
 * The orders are constructed here rather than read from the fixtures, because
 * the fixtures mirror the development store and the store does not hold these
 * scenarios until it is seeded with them. When it does, the golden set gets
 * cases against the real orders; these tests are about what the loop does with
 * the state, which does not depend on which order carries it.
 */

const base = mockOrders.find((o) => o.name === '#1886-1002')!;
const authorized: Order = { ...base, name: '#1886-7001', financialStatus: 'authorized' };
const partiallyPaid: Order = { ...base, name: '#1886-7002', financialStatus: 'partially_paid' };

describe('payment states', () => {
  let tenantId: TenantId;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('payment');
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await disconnect();
  });

  const turn = (text: string, model: ReturnType<typeof scripted>) => {
    const deps = depsWith(model);
    deps.shopify = new MockShopifyClient({
      orders: [...mockOrders, authorized, partiallyPaid],
      products: mockProducts,
    });
    return runTurn({ tenantId, channel: 'web', externalConversationId: uniqueId('p'), text }, deps);
  };

  const lookup = (order: string) => ({
    tools: [{ name: 'lookup_order', input: { order_number: order, email: 'sara@example.com' } }],
  });

  it('answers a status question about an authorized order without a payment field to repeat', async () => {
    const r = await turn(
      'has order 1886-7001 shipped? sara@example.com',
      scripted([lookup('1886-7001'), { text: 'Order #1886-7001 has not shipped yet.' }]),
    );
    expect(r.status).toBe('answered');
    const output = r.recorder.toolCalls[0]!.output as {
      ok: boolean;
      order: Record<string, unknown>;
    };
    expect(output.ok).toBe(true);
    // Nothing to repeat is the protection. A field saying "authorized" is one
    // the model would eventually put in a reply.
    expect(output.order).not.toHaveProperty('payment_status');
    expect(JSON.stringify(output)).not.toMatch(/authori[sz]ed|paid|captur/i);
    expect(output.order.fulfillment_status).toBe('unfulfilled');
  });

  it('keeps the payment field for an order whose payment is simply settled', async () => {
    const r = await turn(
      'has order 1886-1002 shipped? sara@example.com',
      scripted([lookup('1886-1002'), { text: 'Order #1886-1002 has not shipped yet.' }]),
    );
    const output = r.recorder.toolCalls[0]!.output as { order: Record<string, unknown> };
    expect(output.order.payment_status).toBe('paid');
  });

  it('hands a partially paid order to the team whatever was asked', async () => {
    const r = await turn(
      'where is order 1886-7002? sara@example.com',
      scripted([
        lookup('1886-7002'),
        // What a helpful model might say next. It must never reach anyone.
        { text: 'Your order is on its way, and there is 459.00 SAR still to pay.' },
      ]),
    );
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('payment_outstanding');
    expect(r.reply).toBe(systemMessage('escalated', 'en'));
    expect(r.reply).not.toMatch(/459|still to pay/);
    // And the tool gave the model no figure to explain a balance with.
    const output = r.recorder.toolCalls[0]!.output as { ok: boolean };
    expect(output.ok).toBe(false);
    expect(JSON.stringify(output)).not.toMatch(/\d+\.\d{2}/);
  });

  it('verifies identity before handing over, so a wrong email learns nothing', async () => {
    // The hand-over is itself information: "this order has a payment problem".
    // It must be as unavailable to a stranger as the order is.
    const deps = depsWith(
      scripted([
        {
          tools: [
            { name: 'lookup_order', input: { order_number: '1886-7002', email: 'x@example.com' } },
          ],
        },
        { text: 'I could not verify that order.' },
      ]),
    );
    deps.shopify = new MockShopifyClient({
      orders: [...mockOrders, partiallyPaid],
      products: mockProducts,
    });
    const r = await runTurn(
      { tenantId, channel: 'web', externalConversationId: uniqueId('p'), text: 'order 1886-7002' },
      deps,
    );
    expect(r.recorder.escalation).toBeUndefined();
    const output = r.recorder.toolCalls[0]!.output as { error: { code: string } };
    expect(output.error.code).toBe('not_verified');
  });

  it('passes the second total and what is still on the order', async () => {
    const r = await turn(
      'order 1886-1007 nora@example.com — why is the total different?',
      scripted([
        {
          tools: [
            {
              name: 'lookup_order',
              input: { order_number: '1886-1007', email: 'nora@example.com' },
            },
          ],
        },
        { text: 'The order came to 344.00 SAR and now comes to 215.00 SAR.' },
      ]),
    );
    const output = r.recorder.toolCalls[0]!.output as {
      order: {
        total: string;
        current_total: string;
        items: { title: string; still_on_order: number }[];
      };
    };
    expect(output.order.total).toBe('344.00 SAR');
    expect(output.order.current_total).toBe('215.00 SAR');
    expect(output.order.items.find((i) => i.title === 'TFMC Tote Bag')?.still_on_order).toBe(0);
    // Both figures came from the tool, so the literal gate lets them through.
    expect(r.status).toBe('answered');
  });
});
