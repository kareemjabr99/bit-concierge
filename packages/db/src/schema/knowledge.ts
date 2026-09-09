import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** product | collection | page | article | policy | upload */
    sourceType: text('source_type').notNull(),
    /** Shopify GID, or an upload identifier. */
    sourceId: text('source_id').notNull(),
    url: text('url'),
    title: text('title'),
    lang: text('lang').notNull(),
    content: text('content').notNull(),
    /** sha256 of normalised content. Unchanged hash means no re-embed. */
    contentHash: text('content_hash').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('documents_source_key').on(table.tenantId, table.sourceType, table.sourceId),
    index('documents_tenant_lang_idx').on(table.tenantId, table.lang),
    check('documents_lang_check', sql`${table.lang} in ('en','ar')`),
    check(
      'documents_source_type_check',
      sql`${table.sourceType} in ('product','collection','page','article','policy','upload')`,
    ),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    /** Heading trail this chunk sits under, outermost first. */
    headingPath: text('heading_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Source URL including any anchor, so the agent can link to it. */
    url: text('url'),
    lang: text('lang').notNull(),
    tokenCount: integer('token_count'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chunks_document_ordinal_key').on(table.documentId, table.ordinal),
    index('chunks_tenant_lang_idx').on(table.tenantId, table.lang),
  ],
);

/**
 * Vectors live apart from chunks so that the embedding model is part of the
 * key. One Postgres vector column carries one dimension, so per-chunk dims on
 * `chunks` could never have been enforced. Re-indexing writes new rows beside
 * the old, cutover is one config flip, superseded rows are deleted after.
 * See docs/adr/0004-embeddings.md.
 */
export const chunkEmbeddings = pgTable(
  'chunk_embeddings',
  {
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    embeddingModel: text('embedding_model').notNull(),
    embeddingDims: integer('embedding_dims').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chunkId, table.embeddingModel] }),
    check('chunk_embeddings_dims_check', sql`${table.embeddingDims} = 1536`),
    // HNSW index is created in migration SQL — drizzle-kit push drops the
    // operator class, which Postgres rejects. See docs/adr/0004-embeddings.md.
  ],
);

/**
 * Questions retrieval could not answer above threshold, grouped and deduped.
 * Surfaced in the admin dashboard as the knowledge gap report — a commercial
 * deliverable, not telemetry.
 */
export const knowledgeGaps = pgTable(
  'knowledge_gaps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Lowercased, punctuation-stripped, whitespace-collapsed question. */
    questionNorm: text('question_norm').notNull(),
    /** One verbatim example, for the merchant to read. */
    questionSample: text('question_sample').notNull(),
    lang: text('lang').notNull(),
    occurrences: integer('occurrences').notNull().default(1),
    /** Best retrieval score seen. How close we were to answering it. */
    bestScore: real('best_score'),
    status: text('status').notNull().default('open'),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_gaps_norm_key').on(table.tenantId, table.lang, table.questionNorm),
    index('knowledge_gaps_tenant_status_idx').on(table.tenantId, table.status, table.occurrences),
    check('knowledge_gaps_status_check', sql`${table.status} in ('open','answered','dismissed')`),
  ],
);
