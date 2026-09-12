/**
 * Re-embeds a tenant's chunks under a second embedding model, and removes a
 * superseded one once the cutover is verified.
 *
 * This is the mechanism the model-swap procedure in docs/runbook.md depends on.
 * It is a command rather than a pg-boss job for now, deliberately and
 * temporarily: a swap is a supervised operation with a verification step in the
 * middle, so a human runs each half and reads the output between them. Wiring
 * it to the queue is Phase 4 work, when webhook-driven ingestion needs the
 * worker anyway.
 *
 *   pnpm --filter @bitc/rag reindex -- --to KEY            backfill, nothing removed
 *   pnpm --filter @bitc/rag reindex -- --status            what exists per model
 *   pnpm --filter @bitc/rag reindex -- --drop KEY --yes    remove a superseded model
 *
 * Backfill writes new rows beside the old ones. Nothing is removed until you
 * ask, and --drop refuses to remove the model a tenant is currently using.
 * See docs/adr/0004-embeddings.md.
 */
import { sql } from 'drizzle-orm';
import { asTenantId, readEnv } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey, withTenant } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import { cachedEmbedder, resolveEmbedder } from '@bitc/models';
import { backfillEmbeddings, dropEmbeddings } from '../src/index.ts';

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const tenantKey = arg('tenant', 'pk_dev_1886');
const resolved = await resolveTenantByWidgetKey(tenantKey);
if (!resolved) {
  console.error(`No active tenant for "${tenantKey}". Run: pnpm db:seed`);
  process.exit(1);
}
const tenantId = asTenantId(resolved);
const config = await loadTenantConfig(tenantId);

interface ModelRow extends Record<string, unknown> {
  embedding_model: string;
  n: number;
}

const status = async (): Promise<void> => {
  const rows = await withTenant(tenantId, async (tx) => {
    const result = await tx.execute<ModelRow>(sql`
      select embedding_model, count(*)::int as n
      from chunk_embeddings group by embedding_model order by embedding_model
    `);
    return [...result];
  });
  const [{ total } = { total: 0 }] = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ total: number }>(sql`select count(*)::int as total from chunks`);
    return [...r];
  });
  console.log(`chunks: ${total}`);
  if (rows.length === 0) console.log('  no embeddings');
  for (const row of rows) {
    const active = row.embedding_model === config.embeddingModel ? '  ← active' : '';
    const complete = row.n === total ? '' : `  (${total - row.n} missing)`;
    console.log(
      `  ${row.embedding_model.padEnd(40)} ${String(row.n).padStart(5)}${complete}${active}`,
    );
  }
};

try {
  if (has('status') || (!has('to') && !has('drop'))) {
    await status();
  } else if (has('to')) {
    const target = arg('to');
    const models = readEnv('models');
    const embedder = cachedEmbedder(
      resolveEmbedder(target, { googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY }),
      { dir: process.env.BITC_EMBED_CACHE ?? '.embed-cache' },
    );
    console.log(`backfilling ${target} …`);
    const result = await backfillEmbeddings(tenantId, { embedder });
    console.log(`  ${result.embedded} embedded, ${result.alreadyPresent} already present`);
    console.log(`  cache: ${embedder.stats.hits} hits, ${embedder.stats.misses} misses`);
    console.log('');
    await status();
    console.log('');
    console.log(
      `Nothing has changed for customers yet. Point the tenant at it when you are ready:\n` +
        `  UPDATE tenant_config SET embedding_model = '${target}' WHERE tenant_id = '${tenantId}';\n` +
        `Then verify retrieval, and only then remove the old model with --drop.`,
    );
  } else {
    const victim = arg('drop');
    if (victim === config.embeddingModel) {
      console.error(
        `Refusing: "${victim}" is the tenant's active embedding model.\n` +
          'Point tenant_config.embedding_model at the new model first.',
      );
      process.exit(1);
    }
    if (!has('yes')) {
      console.error(`This removes every vector for "${victim}". Re-run with --yes to confirm.`);
      process.exit(1);
    }
    const removed = await dropEmbeddings(tenantId, victim);
    console.log(`removed ${removed} vectors for ${victim}`);
    await status();
  }
} finally {
  await disconnect();
}
