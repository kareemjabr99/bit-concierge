import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect } from '@bitc/db';
import type { TenantId } from '@bitc/core';
import {
  asksForHuman,
  checkEscalationOrder,
  IMMEDIATE_ESCALATION_REASONS,
  MAX_ESCALATION_REFUSALS,
  runTurn,
  SEARCH_FIRST_CODE,
  type ToolCallRecord,
} from '../src/index.ts';
import {
  depsWith,
  dropTenant,
  prepareDatabase,
  scripted,
  seedTestTenant,
  uniqueId,
} from './helpers.ts';

/**
 * escalate_to_human is refused until the turn has searched or looked
 * something up. Enforced in the tool, not the prompt; see
 * src/guard/escalation-order.ts for the exemptions and why each exists.
 */

const call = (name: string, output: unknown = { ok: true }): ToolCallRecord => ({
  name,
  input: {},
  output,
  ok: (output as { ok?: boolean }).ok ?? false,
  latencyMs: 1,
});
const refused = call('escalate_to_human', {
  ok: false,
  error: { code: SEARCH_FIRST_CODE, message: 'Search first.' },
});

describe('checkEscalationOrder', () => {
  const plain = 'do you sell shoes';

  it('refuses an escalation with nothing looked up first', () => {
    expect(
      checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: [] }),
    ).toEqual({ allow: false });
  });

  it('refuses whatever reason the model gives, except the immediate ones', () => {
    for (const reason of [
      'no_answer',
      'order_change',
      'refund_or_money',
      'repeated_question',
      'other',
    ])
      expect(checkEscalationOrder({ reason, customerText: plain, toolCalls: [] }).allow).toBe(
        false,
      );
  });

  it('does not take the model’s word that the customer wants a human', () => {
    // The reason is the model's label. The customer said nothing of the kind.
    expect(
      checkEscalationOrder({ reason: 'wants_human', customerText: plain, toolCalls: [] }).allow,
    ).toBe(false);
  });

  it('allows an escalation after one search, including a search that found nothing', () => {
    const empty = call('search_knowledge', {
      ok: false,
      error: { code: 'no_results', message: '' },
    });
    expect(
      checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: [empty] }),
    ).toEqual({ allow: true, why: 'looked' });
  });

  it('counts every search and lookup tool as having looked', () => {
    for (const name of [
      'search_knowledge',
      'lookup_order',
      'search_products',
      'check_availability',
      'get_shipping_estimate',
    ])
      expect(
        checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: [call(name)] })
          .allow,
      ).toBe(true);
  });

  it('does not count a refused escalation as having looked', () => {
    // With the cap above one, a refusal must not open the gate by itself.
    // At the current cap it does open it — as the cap, not as a lookup.
    const verdict = checkEscalationOrder({
      reason: 'no_answer',
      customerText: plain,
      toolCalls: [refused],
    });
    expect(verdict).toEqual({ allow: true, why: 'refusal_cap' });
  });

  it('allows an explicit request for a human with nothing looked up', () => {
    for (const text of [
      'let me talk to a manager',
      'can I speak to a real person please',
      'I want to talk to someone',
      'connect me to customer service',
      'are you a human?',
      'is there an agent I can chat with',
      'ابي اكلم موظف',
      'أبغى خدمة العملاء',
    ])
      expect(
        checkEscalationOrder({ reason: 'other', customerText: text, toolCalls: [] }),
        text,
      ).toEqual({ allow: true, why: 'asked_for_human' });
  });

  it('does not read an ordinary question as a request for a person', () => {
    for (const text of [
      'do you sell shoes',
      'where is my order 1886-1001',
      'is there a size guide for the hoodie',
      'what is your return policy',
      'let me know when the M is back',
    ])
      expect(asksForHuman(text), text).toBe(false);
  });

  it('exempts exactly the reasons the prompt escalates immediately: complaint', () => {
    expect([...IMMEDIATE_ESCALATION_REASONS]).toEqual(['complaint']);
    expect(
      checkEscalationOrder({
        reason: 'complaint',
        customerText: 'your delivery driver was rude to me',
        toolCalls: [],
      }),
    ).toEqual({ allow: true, why: 'immediate_reason' });
  });

  it('lets an insistent escalation through after the refusal cap, not before', () => {
    expect(MAX_ESCALATION_REFUSALS).toBe(1);
    const before = Array.from({ length: MAX_ESCALATION_REFUSALS - 1 }, () => refused);
    const at = Array.from({ length: MAX_ESCALATION_REFUSALS }, () => refused);
    expect(
      checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: before }).allow,
    ).toBe(false);
    expect(
      checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: at }),
    ).toEqual({ allow: true, why: 'refusal_cap' });
  });

  it('does not count other failed tools toward the cap', () => {
    const failed = call('escalate_to_human', {
      ok: false,
      error: { code: 'tool_error', message: '' },
    });
    expect(
      checkEscalationOrder({ reason: 'no_answer', customerText: plain, toolCalls: [failed] }).allow,
    ).toBe(false);
  });
});

describe('escalation order, through a turn', () => {
  let tenantId: TenantId;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('escalation-order');
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await disconnect();
  });

  const turn = (text: string, model: ReturnType<typeof scripted>) =>
    runTurn(
      { tenantId, channel: 'web', externalConversationId: uniqueId('c'), text },
      depsWith(model),
    );

  const escalateWith = (reason: string) => ({
    tools: [{ name: 'escalate_to_human', input: { reason, summary: 'Customer needs the team.' } }],
  });

  it('escalating first is refused, and the model is told to search', async () => {
    const model = scripted([
      escalateWith('no_answer'),
      { tools: [{ name: 'search_knowledge', input: { query: 'do you sell shoes' } }] },
      escalateWith('no_answer'),
      { text: 'I have passed this to the team.' },
    ]);
    const r = await turn('do you sell shoes', model);

    const [first] = r.recorder.toolCalls;
    expect(first?.name).toBe('escalate_to_human');
    expect(first?.output).toMatchObject({ ok: false, error: { code: SEARCH_FIRST_CODE } });
    // The refusal is a tool result the model reads, telling it to search.
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toMatch(/Search first/);
    expect(r.recorder.toolCalls.map((t) => t.name)).toEqual([
      'escalate_to_human',
      'search_knowledge',
      'escalate_to_human',
    ]);
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('no_answer');
  });

  it('a refused escalation writes nothing: the turn is not handed over', async () => {
    const model = scripted([
      escalateWith('other'),
      { text: 'Could you tell me a little more about what you are looking for?' },
    ]);
    const r = await turn('hello there', model);
    expect(r.recorder.escalation).toBeUndefined();
    expect(r.status).toBe('answered');
  });

  it('an explicit request for a human escalates with nothing looked up', async () => {
    const model = scripted([escalateWith('wants_human'), { text: 'Passed to the team.' }]);
    const r = await turn('let me talk to a manager', model);
    expect(r.recorder.toolCalls.map((t) => t.name)).toEqual(['escalate_to_human']);
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('wants_human');
  });

  it('each immediate category escalates with nothing looked up', async () => {
    for (const reason of IMMEDIATE_ESCALATION_REASONS) {
      const model = scripted([escalateWith(reason), { text: 'Passed to the team.' }]);
      const r = await turn('your delivery driver was rude to me and I am furious', model);
      expect(
        r.recorder.toolCalls.map((t) => t.name),
        reason,
      ).toEqual(['escalate_to_human']);
      expect(r.status, reason).toBe('escalated');
      expect(r.recorder.escalation?.reason, reason).toBe(reason);
    }
  });

  it('escalating after one search is allowed', async () => {
    const model = scripted([
      { tools: [{ name: 'search_knowledge', input: { query: 'gift wrapping' } }] },
      escalateWith('no_answer'),
      { text: 'Passed to the team.' },
    ]);
    const r = await turn('do you gift wrap', model);
    expect(r.recorder.toolCalls.map((t) => t.name)).toEqual([
      'search_knowledge',
      'escalate_to_human',
    ]);
    expect(r.status).toBe('escalated');
  });

  it('cannot loop: an insistent model is let through at the cap, and the turn ends', async () => {
    const model = scripted([
      ...Array.from({ length: MAX_ESCALATION_REFUSALS + 1 }, () => escalateWith('no_answer')),
      { text: 'Passed to the team.' },
    ]);
    const r = await turn('do you sell shoes', model);
    const outcomes = r.recorder.toolCalls.map(
      (t) => (t.output as { error?: { code?: string } }).error?.code ?? 'ok',
    );
    expect(outcomes).toEqual([
      ...Array.from({ length: MAX_ESCALATION_REFUSALS }, () => SEARCH_FIRST_CODE),
      'ok',
    ]);
    expect(r.status).toBe('escalated');
    expect(r.recorder.escalation?.reason).toBe('no_answer');
    // Handed over by the model, not by the step limit.
    expect(model.doGenerateCalls).toHaveLength(MAX_ESCALATION_REFUSALS + 2);
  });
});
