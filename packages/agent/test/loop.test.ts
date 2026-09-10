import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { disconnect } from '@bitc/db';
import type { TenantId } from '@bitc/core';
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
 * The section 9 scenarios, driven by a scripted model so every assertion is
 * about what the LOOP does with a given model behaviour — tool routing,
 * the identity gate, both halves of the grounding gate, escalation, caps and
 * persistence — not about what a model happens to say today.
 */
describe('agent turn', () => {
  let tenantId: TenantId;
  let sql: postgres.Sql;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('loop');
    sql = admin();
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await sql.end();
    await disconnect();
  });

  const turn = (
    text: string,
    model: ReturnType<typeof scripted>,
    externalConversationId = uniqueId('c'),
  ) => runTurn({ tenantId, channel: 'web', externalConversationId, text }, depsWith(model));

  it('order status: verified lookup, grounded reply, everything persisted', async () => {
    const model = scripted([
      {
        tools: [
          {
            name: 'lookup_order',
            input: { order_number: '1886-2041', email: 'ahmed@example.com' },
          },
        ],
      },
      {
        text: 'Order #1886-2041 is with SMSA and on its way. You can follow it here: https://track.example/SMSA1886204100',
      },
    ]);
    const conv = uniqueId('c');
    const r = await turn('where is my order 1886-2041, ahmed@example.com', model, conv);

    expect(r.status).toBe('answered');
    expect(r.reply).toContain('https://track.example/SMSA1886204100');
    expect(r.recorder.toolCalls.map((t) => t.name)).toEqual(['lookup_order']);
    expect(r.grounding?.literal.ok).toBe(true);
    expect(r.steps).toBe(2);
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 40 });

    const rows = await sql.unsafe<
      { role: string; model: string | null; prompt_tokens: number | null }[]
    >(
      `SELECT m.role, m.model, m.prompt_tokens FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.external_id = $1 ORDER BY m.created_at`,
      [conv],
    );
    expect(rows.map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(rows[1]?.model).toBe('google:gemini-3.8-flash');
    expect(rows[1]?.prompt_tokens).toBe(200);

    const [usage] = await sql.unsafe<{ prompt_tokens: string; llm_calls: number }[]>(
      `SELECT prompt_tokens, llm_calls FROM usage_daily WHERE tenant_id = $1 AND channel = 'web'`,
      [tenantId],
    );
    expect(Number(usage?.prompt_tokens)).toBeGreaterThanOrEqual(200);
  });

  it('wrong email: nothing about the order leaks, and the attempt is recorded', async () => {
    const model = scripted([
      {
        tools: [
          {
            name: 'lookup_order',
            input: { order_number: '1886-2041', email: 'stranger@example.com' },
          },
        ],
      },
      {
        text: 'I could not verify that order with those details. Please check the order number and the email you used at checkout.',
      },
    ]);
    const conv = uniqueId('c');
    const r = await turn('order 1886-2041 stranger@example.com', model, conv);

    expect(r.status).toBe('answered');
    expect(r.reply).not.toMatch(/SMSA|track\.example|189/);
    const call = r.recorder.toolCalls[0]!;
    expect(call.ok).toBe(false);
    expect((call.output as { error: { code: string } }).error.code).toBe('not_verified');

    const [attempt] = await sql.unsafe<{ outcome: string; order_number_hash: string | null }[]>(
      `SELECT a.outcome, a.order_number_hash FROM order_lookup_attempts a JOIN conversations c ON c.id = a.conversation_id WHERE c.external_id = $1`,
      [conv],
    );
    expect(attempt?.outcome).toBe('mismatch');
    expect(attempt?.order_number_hash).not.toContain('2041');
  });

  it('policy question: retrieval, a cited answer, markers stripped for the customer', async () => {
    const model = scripted([
      { tools: [{ name: 'search_knowledge', input: { query: 'return an item', top_k: 3 } }] },
      {
        text: 'You can return within 14 days of delivery as long as it is unworn with tags on. [[c:fx-returns-window]] Want me to check anything else?',
      },
    ]);
    const r = await turn('what is your return policy', model);

    expect(r.status).toBe('answered');
    expect(r.reply).not.toContain('[[c:');
    expect(r.reply).toContain('within 14 days');
    expect(r.grounding?.citations.cited).toEqual(['fx-returns-window']);
    expect(r.recorder.retrievalHits[0]?.chunkId).toBe('fx-returns-window');
  });

  it('unanswerable question: the model escalates, and the row exists', async () => {
    const model = scripted([
      { tools: [{ name: 'search_knowledge', input: { query: 'do you sell shoes' } }] },
      {
        tools: [
          {
            name: 'escalate_to_human',
            input: { reason: 'no_answer', summary: 'Customer asks whether the store sells shoes.' },
          },
        ],
      },
      { text: 'I have passed this to the team and someone will get back to you here.' },
    ]);
    const conv = uniqueId('c');
    const r = await turn('do you sell shoes', model, conv);

    expect(r.status).toBe('escalated');
    expect(r.recorder.toolCalls.map((t) => t.name)).toEqual([
      'search_knowledge',
      'escalate_to_human',
    ]);
    expect(r.recorder.toolCalls[0]?.ok).toBe(false);
    expect(r.recorder.escalation?.reason).toBe('no_answer');

    const [row] = await sql.unsafe<{ status: string; delivery_status: string }[]>(
      `SELECT c.status, e.delivery_status FROM conversations c JOIN escalations e ON e.conversation_id = c.id WHERE c.external_id = $1`,
      [conv],
    );
    expect(row).toMatchObject({ status: 'escalated', delivery_status: 'pending' });
  });

  it('complaint: immediate escalation, no attempt to resolve', async () => {
    const model = scripted([
      {
        tools: [
          {
            name: 'escalate_to_human',
            input: { reason: 'complaint', summary: 'Customer is upset about a delivery agent.' },
          },
        ],
      },
      {
        text: 'I am sorry about that. I have passed this to the team and someone will follow up with you here.',
      },
    ]);
    const r = await turn('your delivery guy was rude to me', model);
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('complaint');
  });

  it('a fabricated order number is suppressed and escalated, never sent', async () => {
    const model = scripted([
      { text: 'Your order #1886-9999 shipped yesterday and will arrive on 12 September.' },
    ]);
    const r = await turn('where is my order', model);

    expect(r.status).toBe('suppressed');
    expect(r.reply).not.toContain('1886-9999');
    expect(r.grounding?.literal.ok).toBe(false);
    expect(r.grounding?.literal.misses.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['order_number', 'date']),
    );
    expect(r.recorder.escalation?.reason).toBe('grounding_failure');
    expect(r.rawModelText).toContain('1886-9999');
  });

  it('an uncited policy claim is suppressed, even with no literal in it', async () => {
    const model = scripted([{ text: 'Returns are accepted within 30 days, no questions asked.' }]);
    const r = await turn('can I return this', model);

    expect(r.status).toBe('suppressed');
    expect(r.grounding?.literal.ok).toBe(true);
    expect(r.grounding?.citations.ok).toBe(false);
    expect(r.grounding?.citations.misses[0]?.reason).toBe('no_retrieval');
  });

  it('out of stock: a stock claim backed by a live check passes', async () => {
    const model = scripted([
      { tools: [{ name: 'check_availability', input: { product_handle: 'sadu-hoodie' } }] },
      { text: 'The Sadu Hoodie is sold out at the moment. I cannot say when it will be back.' },
    ]);
    const r = await turn('is the sadu hoodie in stock', model);
    expect(r.status).toBe('answered');
    expect(r.grounding?.literal.ok).toBe(true);
  });

  it('a loop that never converges hits the step cap and escalates', async () => {
    const model = scripted(
      Array.from({ length: 7 }, () => ({
        tools: [{ name: 'search_products', input: { query: 'tee' } }],
      })),
    );
    const r = await turn('show me everything', model);
    expect(r.status).toBe('escalated');
    expect(r.steps).toBe(5);
    expect(r.recorder.escalation?.reason).toBe('step_limit');
  });

  it('once escalated, the thread belongs to the team: no reply, no model call', async () => {
    const conv = uniqueId('c');
    await turn(
      'I want a refund',
      scripted([
        {
          tools: [
            {
              name: 'escalate_to_human',
              input: { reason: 'refund_or_money', summary: 'Refund request.' },
            },
          ],
        },
        { text: 'Passed to the team.' },
      ]),
      conv,
    );

    const model = scripted([{ text: 'this must never be generated' }]);
    const r = await turn('hello?', model, conv);
    expect(r.status).toBe('with_team');
    expect(r.reply).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('a provider failure after a successful escalation is still an escalation', async () => {
    const model = scripted([
      {
        tools: [
          {
            name: 'escalate_to_human',
            input: { reason: 'wants_human', summary: 'Wants a manager.' },
          },
        ],
      },
      { throws: 'provider 503' },
    ]);
    const r = await turn('let me talk to a manager', model);
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('wants_human');
    expect(r.reply).not.toMatch(/went wrong/i);
  });

  it('tool failure: says so and escalates rather than improvising', async () => {
    const model = scripted([
      {
        tools: [
          {
            name: 'lookup_order',
            input: { order_number: '1886-2041', email: 'ahmed@example.com' },
          },
        ],
      },
      { text: 'should not be used' },
    ]);
    const deps = depsWith(model);
    deps.shopify = {
      ...deps.shopify,
      getOrderByName: async () => {
        throw new Error('boom');
      },
    } as typeof deps.shopify;
    const r = await runTurn(
      { tenantId, channel: 'web', externalConversationId: uniqueId('c'), text: 'order 1886-2041' },
      deps,
    );
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('tool_failure');
    expect(r.reply).not.toContain('should not be used');
  });
});

describe('caps', () => {
  let tenantId: TenantId;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('caps', { maxTurnsPerConversation: 1, maxTokensPerDay: 100 });
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await disconnect();
  });

  it('escalates at the conversation turn cap and stops at the daily token cap', async () => {
    const conv = uniqueId('c');
    const first = await runTurn(
      { tenantId, channel: 'web', externalConversationId: conv, text: 'hi' },
      depsWith(scripted([{ text: 'Hello. How can I help?' }])),
    );
    expect(first.status).toBe('answered');

    // Turn cap (1) reached on the same conversation.
    const second = await runTurn(
      { tenantId, channel: 'web', externalConversationId: conv, text: 'again' },
      depsWith(scripted([{ text: 'x' }])),
    );
    expect(second.status).toBe('escalated');
    expect(second.recorder.escalation?.reason).toBe('conversation_cap');

    // 120 tokens used today against a cap of 100: the next model call is refused before it happens.
    const capped = scripted([{ text: 'x' }]);
    const third = await runTurn(
      { tenantId, channel: 'web', externalConversationId: uniqueId('c'), text: 'new' },
      depsWith(capped),
    );
    expect(third.status).toBe('capped');
    expect(capped.doGenerateCalls).toHaveLength(0);
  });
});
