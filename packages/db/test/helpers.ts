import postgres from 'postgres';
import { up } from '../src/migrate.ts';

/**
 * The suite truncates tenants and drops the schema. It therefore owns a
 * database of its own — bitconcierge_test by default — and never reads
 * DATABASE_URL, so a developer's data cannot be on the receiving end.
 * Override with TEST_DATABASE_URL_MIGRATOR / TEST_DATABASE_URL (CI does).
 */
export const ADMIN_URL =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  'postgres://postgres:postgres@localhost:55432/bitconcierge_test';

/** The application role. Row-level security applies to it. */
export const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://bitc_app_local:localdev@localhost:55432/bitconcierge_test';

export const admin = () => postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
export const app = () => postgres(APP_URL, { max: 1, onnotice: () => {} });

const databaseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');

/** CREATE DATABASE cannot run inside the target; use the maintenance database. */
const ensureDatabase = async (): Promise<void> => {
  const name = databaseName(ADMIN_URL);
  const maintenance = new URL(ADMIN_URL);
  maintenance.pathname = '/postgres';
  const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await sql.unsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
    if (!exists) await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
};

/**
 * Creates the test database if needed, brings it up to date, and ensures the
 * local login role exists. Migrations create bitc_app as a NOLOGIN group
 * role, which is right for a managed database but cannot connect; locally we
 * add a member that can.
 */
export const prepareDatabase = async (): Promise<void> => {
  await ensureDatabase();
  const sql = admin();
  try {
    await up(sql);
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bitc_app_local') THEN
          CREATE USER bitc_app_local WITH PASSWORD 'localdev';
        END IF;
      END $$;
      GRANT bitc_app TO bitc_app_local;
      GRANT CONNECT ON DATABASE "${databaseName(ADMIN_URL)}" TO bitc_app_local;
    `);
  } finally {
    await sql.end();
  }
};

export interface SeededTenant {
  id: string;
  name: string;
  shop: string;
  widgetKey: string;
}

/** Seeds a tenant and one row in every tenant-scoped table. */
export const seedTenant = async (sql: postgres.Sql, label: string): Promise<SeededTenant> => {
  const shop = `${label}.myshopify.com`;
  const widgetKey = `pk_${label}`;
  const [tenant] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO tenants (name, shopify_domain, widget_public_key) VALUES ($1, $2, $3) RETURNING id`,
    [label, shop, widgetKey],
  );
  const id = tenant!.id;

  await sql.unsafe(
    `INSERT INTO tenant_config (tenant_id, brand_name, brand_voice, chat_model, embedding_model)
     VALUES ($1, $2, 'calm', 'google:gemini-3.5-flash-lite', 'google:gemini-embedding-001@1536')`,
    [id, label],
  );
  const [doc] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO documents (tenant_id, source_type, source_id, lang, content, content_hash, title)
     VALUES ($1, 'policy', 'returns', 'en', $2, 'hash', 'Returns') RETURNING id`,
    [id, `${label} returns policy`],
  );
  const [chunk] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO chunks (document_id, tenant_id, ordinal, content, lang)
     VALUES ($1, $2, 0, $3, 'en') RETURNING id`,
    [doc!.id, id, `${label} returns within 14 days`],
  );
  await sql.unsafe(
    `INSERT INTO chunk_embeddings (chunk_id, tenant_id, embedding_model, embedding_dims, embedding)
     VALUES ($1, $2, 'google:gemini-embedding-001@1536', 1536, $3)`,
    [chunk!.id, id, `[${Array.from({ length: 1536 }, () => 0.01).join(',')}]`],
  );
  const [conversation] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO conversations (tenant_id, channel, external_id, lang)
     VALUES ($1, 'web', $2, 'en') RETURNING id`,
    [id, `${label}-conv-1`],
  );
  await sql.unsafe(
    `INSERT INTO messages (conversation_id, tenant_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [conversation!.id, id, `${label} where is my order`],
  );
  await sql.unsafe(
    `INSERT INTO escalations (conversation_id, tenant_id, reason) VALUES ($1, $2, 'no_answer')`,
    [conversation!.id, id],
  );
  await sql.unsafe(
    `INSERT INTO knowledge_gaps (tenant_id, question_norm, question_sample, lang)
     VALUES ($1, $2, $2, 'en')`,
    [id, `${label} do you ship to kuwait`],
  );
  await sql.unsafe(
    `INSERT INTO order_lookup_attempts (tenant_id, conversation_id, outcome)
     VALUES ($1, $2, 'mismatch')`,
    [id, conversation!.id],
  );
  await sql.unsafe(
    `INSERT INTO usage_daily (tenant_id, day, channel, prompt_tokens) VALUES ($1, CURRENT_DATE, 'web', 100)`,
    [id],
  );
  await sql.unsafe(
    `INSERT INTO eval_runs (tenant_id, git_sha, suite, tier, chat_model, embedding_model, reranker)
     VALUES ($1, 'abc123', 'en', 'provisional', 'm', 'e', 'fusion')`,
    [id],
  );
  await sql.unsafe(`INSERT INTO shopify_installs (id, tenant_id, shop) VALUES ($1, $2, $3)`, [
    `offline_${shop}`,
    id,
    shop,
  ]);
  await sql.unsafe(
    `INSERT INTO conversation_tombstones (tenant_id, conversation_id) VALUES ($1, gen_random_uuid())`,
    [id],
  );
  await sql.unsafe(`INSERT INTO escalation_digests (tenant_id, escalation_count) VALUES ($1, 3)`, [
    id,
  ]);

  return { id, name: label, shop, widgetKey };
};

export const truncateAll = async (sql: postgres.Sql): Promise<void> => {
  await sql.unsafe(`TRUNCATE tenants CASCADE`);
};

/** Every table carrying tenant_id. The RLS suite walks all of them. */
export const TENANT_SCOPED_TABLES = [
  'tenant_config',
  'shopify_installs',
  'documents',
  'chunks',
  'chunk_embeddings',
  'knowledge_gaps',
  'conversations',
  'messages',
  'escalation_digests',
  'escalations',
  'order_lookup_attempts',
  'conversation_tombstones',
  'eval_runs',
  'usage_daily',
] as const;
