import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect } from '@bitc/db';
import type { TenantId } from '@bitc/core';
import { MockShopifyClient, mockOrders, mockProducts } from '@bitc/shopify';
import { runTurn } from '../src/index.ts';
import {
  admin,
  depsWith,
  dropTenant,
  prepareDatabase,
  scripted,
  seedTestTenant,
  uniqueId,
} from './helpers.ts';

/**
 * An order's status URL is the credential for that order (docs/adr/0012): it
 * opens the items, address and tracking with no login. It may reach the
 * customer who verified the order and no one else.
 *
 * These tests are about the URL specifically, in the places it could go that
 * are not the verified customer's reply: an unverified session, a withheld
 * reply's escalation, and the logs.
 */

const order = mockOrders.find((o) => o.name === '#1886-1001')!;
const URL_OF_1001 = order.statusUrl!;

describe('status-link containment', () => {
  let tenantId: TenantId;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('statuslink');
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await disconnect();
  });

  const lookup = (email: string) => ({
    tools: [{ name: 'lookup_order', input: { order_number: '1886-1001', email } }],
  });

  const turn = (conversation: string, text: string, model: ReturnType<typeof scripted>) =>
    runTurn(
      { tenantId, channel: 'web', externalConversationId: conversation, text },
      depsWith(model),
    );

  it('control: a verified customer does receive their link', async () => {
    // Without this the tests below would pass for a build that never sends it.
    const r = await turn(
      uniqueId('v'),
      'where is order 1886-1001? ahmed@example.com',
      scripted([lookup('ahmed@example.com'), { text: `Order #1886-1001: ${URL_OF_1001}` }]),
    );
    expect(r.status).toBe('answered');
    expect(r.reply).toContain(URL_OF_1001);
  });

  it('the stranger case: a wrong email gets an error that carries no link', async () => {
    const r = await turn(
      uniqueId('s'),
      'order 1886-1001, stranger@example.com',
      scripted([
        lookup('stranger@example.com'),
        { text: 'Please check the order number and email.' },
      ]),
    );
    const call = r.recorder.toolCalls[0]!;
    expect(call.ok).toBe(false);
    expect(JSON.stringify(call.output)).not.toMatch(/orders\/|status|https?:/i);
    expect(r.reply).not.toMatch(/https?:|orders\//);
  });

  it('a session that verified an order earlier cannot be made to repeat its link for a failed lookup', async () => {
    // The link is in the conversation's history. A turn that then fails to
    // verify must not be able to put it back in a reply: the gate compares a
    // reply's URLs with THIS turn's tool results, and a failed lookup has none.
    const conversation = uniqueId('h');
    const first = await turn(
      conversation,
      'order 1886-1001 ahmed@example.com',
      scripted([lookup('ahmed@example.com'), { text: `Order #1886-1001: ${URL_OF_1001}` }]),
    );
    expect(first.reply).toContain(URL_OF_1001);

    const second = await turn(
      conversation,
      'actually, order 1886-1001 is for stranger@example.com',
      scripted([lookup('stranger@example.com'), { text: `Here it is: ${URL_OF_1001}` }]),
    );
    expect(second.status).toBe('suppressed');
    expect(second.reply).not.toContain(URL_OF_1001);
    expect(second.reply).not.toMatch(/https?:|orders\//);
  });

  it('the URL rule itself stops it: a link with no digits for any other check to catch', async () => {
    // Every other literal check (order numbers, long digit runs) would catch
    // the mock's /orders/status/1001. A real link's key is hex and can carry
    // none, so this one is held by the URL comparison alone.
    const keyOnly = 'https://dev-store.example/orders/status/abcdefabcdefabcdef';
    const deps = (model: ReturnType<typeof scripted>) => {
      const d = depsWith(model);
      d.shopify = new MockShopifyClient({
        orders: [...mockOrders, { ...order, name: '#1886-7101', statusUrl: keyOnly }],
        products: mockProducts,
      });
      return d;
    };
    const lookup7101 = (email: string) => ({
      tools: [{ name: 'lookup_order', input: { order_number: '1886-7101', email } }],
    });
    const conversation = uniqueId('k');
    const verified = await runTurn(
      { tenantId, channel: 'web', externalConversationId: conversation, text: 'order 1886-1001' },
      deps(scripted([lookup7101('ahmed@example.com'), { text: `Your order: ${keyOnly}` }])),
    );
    expect(verified.reply).toContain(keyOnly);

    const stranger = await runTurn(
      { tenantId, channel: 'web', externalConversationId: conversation, text: 'and for stranger?' },
      deps(scripted([lookup7101('stranger@example.com'), { text: `Here: ${keyOnly}` }])),
    );
    expect(stranger.status).toBe('suppressed');
    expect(stranger.reply).not.toContain(keyOnly);
    expect(stranger.grounding?.literal.misses.map((m) => m.kind)).toContain('url');
  });

  it('a link the model produces with no lookup at all never reaches the customer', async () => {
    const r = await turn(
      uniqueId('n'),
      'send me the link to 1886-1001',
      scripted([{ text: `Sure: ${URL_OF_1001}` }]),
    );
    expect(r.status).toBe('suppressed');
    expect(r.reply).not.toContain(URL_OF_1001);
  });

  it('a withheld reply is escalated without the link in the summary or the row', async () => {
    // The gate's summary quotes the literal it refused, and here the literal
    // is the URL. The team gets the order number, not the credential.
    const r = await turn(
      uniqueId('e'),
      'send me the link to 1886-1001',
      scripted([{ text: `Sure: ${URL_OF_1001}` }]),
    );
    expect(r.recorder.escalation?.reason).toBe('grounding_failure');
    expect(r.recorder.escalation?.summary).not.toContain(URL_OF_1001);

    const sql = admin();
    try {
      const rows = await sql.unsafe<{ summary: string; reason: string }[]>(
        `SELECT summary, reason FROM escalations WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.summary).not.toMatch(/https?:\/\/\S*\/orders\//);
        expect(row.reason).not.toMatch(/https?:\/\/\S*\/orders\//);
      }
    } finally {
      await sql.end();
    }
  });

  it('a link the model puts in an escalation summary itself is stripped at the write', async () => {
    const r = await turn(
      uniqueId('m'),
      'my parcel is damaged',
      scripted([
        {
          tools: [
            {
              name: 'escalate_to_human',
              input: { reason: 'complaint', summary: `Damaged parcel. Status page ${URL_OF_1001}` },
            },
          ],
        },
        { text: 'Passed to the team.' },
      ]),
    );
    expect(r.recorder.escalation?.summary).toContain('Damaged parcel');
    expect(r.recorder.escalation?.summary).not.toContain(URL_OF_1001);
    expect(r.recorder.escalation?.summary).toContain('[status-link]');
  });
});
