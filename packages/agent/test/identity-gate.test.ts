import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect } from '@bitc/db';
import { asTenantId, createLogger, type TenantId } from '@bitc/core';
import { MockShopifyClient } from '@bitc/shopify';
import {
  FixtureKnowledge,
  getOrCreateConversation,
  loadTenantConfig,
  verifyOrderIdentity,
  type TurnContext,
} from '../src/index.ts';
import { dropTenant, prepareDatabase, seedTestTenant, uniqueId } from './helpers.ts';

describe('identity gate', () => {
  let tenantId: TenantId;

  beforeAll(async () => {
    await prepareDatabase();
    tenantId = await seedTestTenant('gate', {
      lookupLimits: { perConversation: 3, perIpPerHour: 4 },
    });
  });

  afterAll(async () => {
    await dropTenant(tenantId);
    await disconnect();
  });

  const context = async (ipHash?: string): Promise<TurnContext> => {
    const conversation = await getOrCreateConversation(tenantId, 'web', uniqueId('gate'), 'en');
    return {
      tenantId: asTenantId(tenantId),
      conversationId: conversation.id,
      channel: 'web',
      lang: 'en',
      ...(ipHash ? { ipHash } : {}),
      config: await loadTenantConfig(tenantId),
      shopify: new MockShopifyClient(),
      knowledge: new FixtureKnowledge(),
      recorder: { toolCalls: [], retrievalHits: [] },
      logger: createLogger({ level: 'error', write: () => {} }),
      now: () => new Date(),
    };
  };

  it('verifies with the order email, the customer email, or any casing of either', async () => {
    // #1886-1004 carries k@example.com; the account behind it is omar@. Both
    // verify and neither may be revealed to the other.
    const ctx = await context();
    expect((await verifyOrderIdentity(ctx, '#1886-1004', 'omar@example.com')).ok).toBe(true);
    expect((await verifyOrderIdentity(ctx, '1886-1004', '  K@Example.com ')).ok).toBe(true);
  });

  it('returns byte-identical results for a wrong email and a nonexistent order', async () => {
    const ctx = await context();
    const mismatch = await verifyOrderIdentity(ctx, '#1886-1001', 'wrong@example.com');
    const missing = await verifyOrderIdentity(ctx, '#1886-0000', 'wrong@example.com');
    expect(JSON.stringify(mismatch)).toBe(JSON.stringify(missing));
    expect(mismatch).toEqual({ ok: false, code: 'not_verified' });
  });

  it('verifies a guest order that has no customer record', async () => {
    // customerEmail is null here, not merely equal to the order's. The gate
    // must read the order email without dereferencing an absent customer.
    const ctx = await context();
    expect((await verifyOrderIdentity(ctx, '1886-1006', 'guest@example.com')).ok).toBe(true);
  });

  it('rate-limits per conversation, counting failures and successes alike', async () => {
    const ctx = await context();
    await verifyOrderIdentity(ctx, '#1886-1001', 'a@example.com');
    await verifyOrderIdentity(ctx, '#1886-1001', 'b@example.com');
    await verifyOrderIdentity(ctx, '#1886-1001', 'ahmed@example.com');
    const fourth = await verifyOrderIdentity(ctx, '#1886-1001', 'ahmed@example.com');
    expect(fourth).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('rate-limits per IP across conversations', async () => {
    const ip = `ip-${Date.now()}`;
    for (let i = 0; i < 4; i += 1) {
      await verifyOrderIdentity(await context(ip), '#1886-1001', 'x@example.com');
    }
    const fifth = await verifyOrderIdentity(await context(ip), '#1886-1001', 'ahmed@example.com');
    expect(fifth).toEqual({ ok: false, code: 'rate_limited' });
  });
});
