import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  date,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

/**
 * Daily rollup. Cost per tenant must be answerable with one indexed read, and
 * the daily token cap is checked before every model call — walking `messages`
 * for that would get slower exactly as it matters more.
 */
export const usageDaily = pgTable(
  'usage_daily',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    channel: text('channel').notNull(),
    promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
    llmCalls: integer('llm_calls').notNull().default(0),
    conversations: integer('conversations').notNull().default(0),
    escalations: integer('escalations').notNull().default(0),
    modelCostUsd: numeric('model_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    /**
     * Meta per-message charges. From 1 Oct 2026 free-form replies inside the
     * 24-hour service window are billable, so the WhatsApp add-on has to be
     * priced off measured cost rather than estimates.
     */
    metaMessageCostUsd: numeric('meta_message_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    metaBillableMessages: integer('meta_billable_messages').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.day, table.channel] }),
    index('usage_daily_day_idx').on(table.day),
  ],
);

/**
 * One eval run. The hallucination bar has two halves and they are kept apart
 * on purpose — see docs/adr/0005-grounding.md.
 *
 *   Deterministic, a property of the system:
 *     hallucinationCount   literal facts absent from tool results
 *     citationMissCount    policy claims with no resolvable chunk id
 *
 *   Measured, a sample judged by a person:
 *     policyAccuracySampled  does the claim match what the chunk actually says
 *
 * A run with policySampleReviewedBy unset has no semantic score, only
 * deterministic ones. Reporting must never blur the two into one number.
 */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    gitSha: text('git_sha').notNull(),
    suite: text('suite').notNull(),
    /**
     * provisional — drafted cases; proves the machinery works.
     * validated   — signed off by the merchant's CX side; the real ship bar.
     */
    tier: text('tier').notNull(),

    /** The exact model triple these numbers describe. */
    chatModel: text('chat_model').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    reranker: text('reranker').notNull(),

    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    accuracy: real('accuracy'),
    deflectionRate: real('deflection_rate'),
    escalationPrecision: real('escalation_precision'),
    retrievalHitRate: real('retrieval_hit_rate'),
    p95LatencyMs: integer('p95_latency_ms'),
    costPerConversationUsd: numeric('cost_per_conversation_usd', { precision: 12, scale: 6 }),

    hallucinationCount: integer('hallucination_count'),
    citationMissCount: integer('citation_miss_count'),

    policyAccuracySampled: real('policy_accuracy_sampled'),
    policySampleSize: integer('policy_sample_size'),
    policySampleReviewedBy: text('policy_sample_reviewed_by'),
    policySampleReviewedAt: timestamp('policy_sample_reviewed_at', { withTimezone: true }),

    /** False unless every gate passed, including the model-binding check. */
    meetsShipBar: boolean('meets_ship_bar').notNull().default(false),
    shipBarNotes: text('ship_bar_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('eval_runs_tier_check', sql`${table.tier} in ('provisional','validated')`),
  ],
);
