import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    /** Channel-side thread id: widget session, IG thread, WhatsApp wa_id. */
    externalId: text('external_id').notNull(),
    /** Opaque customer reference. Never a raw email or phone number. */
    customerRef: text('customer_ref'),
    lang: text('lang'),
    status: text('status').notNull().default('open'),
    outcome: text('outcome'),
    turnCount: integer('turn_count').notNull().default(0),
    tokenTotal: bigint('token_total', { mode: 'number' }).notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Set when the retention job strips PII but keeps the exchange. */
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('conversations_external_key').on(table.tenantId, table.channel, table.externalId),
    index('conversations_tenant_status_idx').on(table.tenantId, table.status, table.lastMessageAt),
    check('conversations_channel_check', sql`${table.channel} in ('web','instagram','whatsapp')`),
    check(
      'conversations_status_check',
      sql`${table.status} in ('open','escalated','resolved','closed')`,
    ),
    check(
      'conversations_outcome_check',
      sql`${table.outcome} is null or ${table.outcome} in ('deflected','escalated','abandoned')`,
    ),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls'),
    /** [{ chunkId, score, url }] — what search_knowledge returned this turn. */
    retrievalHits: jsonb('retrieval_hits'),
    /**
     * Grounding gate verdict. Both halves of the hallucination bar:
     * { literal: {...}, citations: {...}, suppressed: bool, reason }.
     * See docs/adr/0005-grounding.md.
     */
    grounding: jsonb('grounding'),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_conversation_idx').on(table.conversationId, table.createdAt),
    index('messages_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('messages_role_check', sql`${table.role} in ('system','user','assistant','tool')`),
  ],
);

export const escalationDigests = pgTable('escalation_digests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  escalationCount: integer('escalation_count').notNull(),
  sentTo: text('sent_to')
    .array()
    .notNull()
    .default(sql`'{}'`),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    summary: text('summary'),
    /** Customer contact details. Carries PII — covered by the merchant DPA. */
    contact: jsonb('contact'),
    sentTo: text('sent_to')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * Above the per-hour cap, escalations are batched into a digest rather
     * than dropped. An escalation storm must not flood the merchant.
     */
    deliveryStatus: text('delivery_status').notNull().default('pending'),
    digestId: uuid('digest_id').references(() => escalationDigests.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('escalations_tenant_created_idx').on(table.tenantId, table.createdAt),
    check(
      'escalations_delivery_status_check',
      sql`${table.deliveryStatus} in ('pending','sent','digested','failed')`,
    ),
  ],
);

/**
 * Every order lookup attempt, for rate limiting and abuse detection. Order
 * numbers and IPs are stored as blind indexes — groupable, not readable.
 */
export const orderLookupAttempts = pgTable(
  'order_lookup_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    ipHash: text('ip_hash'),
    orderNumberHash: text('order_number_hash'),
    outcome: text('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_lookup_attempts_tenant_idx').on(table.tenantId, table.createdAt),
    index('order_lookup_attempts_ip_idx').on(table.ipHash, table.createdAt),
    check(
      'order_lookup_attempts_outcome_check',
      sql`${table.outcome} in ('match','mismatch','not_found','rate_limited')`,
    ),
  ],
);

/**
 * A deletion request is a hard purge. The conversation and its messages are
 * gone; this row records only that something was deleted, so a later audit can
 * tell deletion from data loss.
 */
export const conversationTombstones = pgTable(
  'conversation_tombstones',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.conversationId] })],
);
