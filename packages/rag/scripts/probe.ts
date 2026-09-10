/** Ad-hoc retrieval probe. Prints what the retriever returns for a query. */
import { asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import { cachedEmbedder, resolveEmbedder, resolveReranker } from '@bitc/models';
import { PgKnowledgeSearcher } from '../src/index.ts';

const queries = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tenantId = await resolveTenantByWidgetKey('pk_dev_1886');
if (!tenantId) throw new Error('no dev tenant — run pnpm db:seed');
const config = await loadTenantConfig(asTenantId(tenantId));
const embedder = cachedEmbedder(
  resolveEmbedder(config.embeddingModel, {
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  }),
  { dir: process.env.BITC_EMBED_CACHE ?? '.embed-cache' },
);
const searcher = new PgKnowledgeSearcher(
  asTenantId(tenantId),
  embedder,
  resolveReranker(config.reranker),
);

for (const query of queries) {
  const hits = await searcher.search({
    query,
    lang: 'en',
    topK: 3,
    minScore: config.retrievalMinScore,
  });
  console.log(`\nQ: ${query}   (threshold ${config.retrievalMinScore})`);
  if (hits.length === 0) console.log('   — nothing above threshold');
  for (const hit of hits) {
    console.log(
      `   ${hit.score.toFixed(3)}  ${(hit.title ?? '').slice(0, 26).padEnd(26)}  ${hit.content.replace(/\s+/g, ' ').slice(0, 96)}`,
    );
  }
}
console.log(`\ncache: ${embedder.stats.hits} hits, ${embedder.stats.misses} misses`);
await disconnect();
