import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** myshopify domain. Null until the Shopify app is installed (Phase 4). */
    shopifyDomain: text('shopify_domain'),
    /** Public, non-secret key the widget sends to identify its tenant. */
    widgetPublicKey: text('widget_public_key').notNull(),
    plan: text('plan').notNull().default('pilot'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tenants_shopify_domain_key').on(table.shopifyDomain),
    uniqueIndex('tenants_widget_public_key_key').on(table.widgetPublicKey),
    check('tenants_status_check', sql`${table.status} in ('active','suspended','archived')`),
  ],
);

export const tenantConfig = pgTable(
  'tenant_config',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    brandName: text('brand_name').notNull(),
    brandDescription: text('brand_description'),
    brandVoice: text('brand_voice').notNull(),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{en}'`),
    enabledChannels: text('enabled_channels')
      .array()
      .notNull()
      .default(sql`'{web}'`),

    /** Registry keys, e.g. "google:gemini-3.5-flash-lite". See @bitc/models. */
    chatModel: text('chat_model').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    reranker: text('reranker').notNull().default('llm:google:gemini-3.5-flash-lite'),
    /**
     * The model the Phase 5 ship bar must be measured on. When this differs
     * from chatModel, every eval number on record is void and the ship-bar
     * gate fails closed. See docs/adr/0006-model-abstraction.md.
     */
    productionChatModel: text('production_chat_model'),

    escalationEmails: text('escalation_emails')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Routing and subject-line urgency only. Never reaches customer copy. */
    businessHours: jsonb('business_hours'),
    policyOverrides: jsonb('policy_overrides')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Below this, retrieval is treated as "not found" and the agent escalates. */
    retrievalMinScore: real('retrieval_min_score').notNull().default(0.75),

    retentionDays: integer('retention_days').notNull().default(90),

    maxTokensPerConversation: integer('max_tokens_per_conversation').notNull().default(60000),
    maxTurnsPerConversation: integer('max_turns_per_conversation').notNull().default(25),
    maxTokensPerDay: bigint('max_tokens_per_day', { mode: 'number' }).notNull().default(5000000),
    usageAlertPct: integer('usage_alert_pct').notNull().default(70),

    maxEscalationsPerHour: integer('max_escalations_per_hour').notNull().default(20),

    /** Phase 6. Residency is configuration, not architecture. */
    dataRegion: text('data_region').notNull().default('eu-central-1'),
    anonymiseOnExpiry: boolean('anonymise_on_expiry').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('tenant_config_retention_check', sql`${table.retentionDays} in (30, 90, 365)`),
    check('tenant_config_alert_pct_check', sql`${table.usageAlertPct} between 1 and 99`),
  ],
);

/**
 * Shopify install record. Doubles as the adapter's SessionStorage row so there
 * is one place a shop's access token can live. Token is AES-256-GCM at rest.
 */
export const shopifyInstalls = pgTable(
  'shopify_installs',
  {
    /** Shopify session id. */
    id: text('id').primaryKey(),
    /** Null between OAuth callback and tenant provisioning. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    shop: text('shop').notNull(),
    state: text('state'),
    isOnline: boolean('is_online').notNull().default(false),
    scope: text('scope'),
    expires: timestamp('expires', { withTimezone: true }),

    accessTokenCiphertext: text('access_token_ciphertext'),
    accessTokenIv: text('access_token_iv'),
    accessTokenTag: text('access_token_tag'),
    encryptionKeyVersion: integer('encryption_key_version').notNull().default(1),

    onlineAccessInfo: jsonb('online_access_info'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('shopify_installs_shop_online_key').on(table.shop, table.isOnline)],
);
