import { and, eq, gte, sql } from 'drizzle-orm';
import { blindIndex, safeEqual } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import { normalizeOrderName, type Order } from '@bitc/shopify';
import type { TurnContext } from '../context.ts';

/**
 * The identity gate on order lookups. Order number PLUS a matching email.
 *
 * Two properties matter more than anything else here:
 *  - A wrong email and a nonexistent order produce the SAME result object.
 *    Anything else is an enumeration oracle.
 *  - The email comparison runs in constant time, and runs even when there is
 *    no order, so timing does not become the oracle instead.
 * See docs/adr/0008-limits.md.
 */

export type IdentityOutcome =
  | { ok: true; order: Order }
  | { ok: false; code: 'not_verified' }
  | { ok: false; code: 'rate_limited' };

const NOT_VERIFIED: IdentityOutcome = Object.freeze({
  ok: false,
  code: 'not_verified',
}) as IdentityOutcome;
const RATE_LIMITED: IdentityOutcome = Object.freeze({
  ok: false,
  code: 'rate_limited',
}) as IdentityOutcome;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Development fallback. Refused in production — see readEnv('security'). */
const salt = (): string => {
  const configured = process.env.BLIND_INDEX_SALT;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production')
    throw new Error('BLIND_INDEX_SALT is required in production');
  return 'dev-only-salt-not-for-production';
};

export const verifyOrderIdentity = async (
  ctx: TurnContext,
  orderNumber: string,
  email: string,
): Promise<IdentityOutcome> => {
  const wanted = normalizeOrderName(orderNumber);
  const given = normalizeEmail(email);
  const orderHash = blindIndex(wanted, salt());
  const since = new Date(ctx.now().getTime() - 60 * 60 * 1000);

  const limited = await withTenant(ctx.tenantId, async (tx) => {
    const [conv] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orderLookupAttempts)
      .where(eq(schema.orderLookupAttempts.conversationId, ctx.conversationId));
    if ((conv?.n ?? 0) >= ctx.config.lookupLimits.perConversation) return true;

    if (ctx.ipHash) {
      const [ip] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.orderLookupAttempts)
        .where(
          and(
            eq(schema.orderLookupAttempts.ipHash, ctx.ipHash),
            gte(schema.orderLookupAttempts.createdAt, since),
          ),
        );
      if ((ip?.n ?? 0) >= ctx.config.lookupLimits.perIpPerHour) return true;
    }
    return false;
  });

  const record = (outcome: 'match' | 'mismatch' | 'not_found' | 'rate_limited') =>
    withTenant(ctx.tenantId, (tx) =>
      tx.insert(schema.orderLookupAttempts).values({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        ipHash: ctx.ipHash ?? null,
        orderNumberHash: orderHash,
        outcome,
      }),
    );

  if (limited) {
    await record('rate_limited');
    return RATE_LIMITED;
  }

  const order = await ctx.shopify.getOrderByName(wanted);

  // Compare against something even when nothing was found, so the two paths
  // take the same time.
  const candidates = order
    ? [order.email, order.customerEmail].filter((e): e is string => !!e)
    : [];
  const targets = candidates.length ? candidates : ['nobody@invalid.example'];
  let matched = false;
  for (const target of targets) {
    if (safeEqual(given, normalizeEmail(target))) matched = true;
  }

  if (!order) {
    await record('not_found');
    return NOT_VERIFIED;
  }
  if (!matched) {
    await record('mismatch');
    return NOT_VERIFIED;
  }
  await record('match');
  return { ok: true, order };
};
