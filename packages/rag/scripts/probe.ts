/**
 * Ad-hoc retrieval probe. Prints what the retriever returns for a query, and
 * with --separation reports whether answerable and unanswerable questions
 * occupy distinguishable score ranges.
 *
 *   pnpm --filter @bitc/rag probe -- "question" ["question" ...] [--reranker KEY]
 *   pnpm --filter @bitc/rag probe -- --separation [--reranker KEY]
 */
import { asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import { cachedEmbedder, resolveChatModel, resolveEmbedder, resolveReranker } from '@bitc/models';
import { PgKnowledgeSearcher } from '../src/index.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const tenantId = await resolveTenantByWidgetKey('pk_dev_1886');
if (!tenantId) throw new Error('no dev tenant — run pnpm db:seed');
const config = await loadTenantConfig(asTenantId(tenantId));

const embedder = cachedEmbedder(
  resolveEmbedder(config.embeddingModel, {
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  }),
  { dir: process.env.BITC_EMBED_CACHE ?? '.embed-cache' },
);
const rerankerKey = arg('reranker', config.reranker);
const chat = resolveChatModel(config.chatModel, {
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});
const reranker = resolveReranker(rerankerKey, { model: chat.model });
const searcher = new PgKnowledgeSearcher(asTenantId(tenantId), embedder, reranker);

// The free tier allows 15 chat requests a minute, and an LLM reranker spends
// one per search. Without pacing the later queries 429, the reranker falls
// back to fusion, and the measurement silently becomes a measurement of cosine.
const paceMs = rerankerKey === 'fusion' ? 0 : Number(arg('pace', '5')) * 1000;
const pace = async (): Promise<void> => {
  if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
};

/** Retrieve with no floor, so the raw scores are visible. */
const scores = async (query: string): Promise<number[]> => {
  const hits = await searcher.search({ query, lang: 'en', topK: 3, minScore: 0 });
  return hits.map((hit) => hit.score);
};

// Questions the corpus answers, and questions it does not. Held here rather
// than in the golden set because this measures retrieval, not the agent.
const ANSWERABLE = [
  'how long do I have to return something',
  'do you ship outside Saudi Arabia',
  'can I return a sale item',
  'what is the chest measurement on a large t-shirt',
  'how do I start a return',
  'will I pay customs on an international order',
];
const UNANSWERABLE = [
  'do you offer gift wrapping',
  'will you match a lower price',
  'do you sell shoes for toddlers',
  'can I book a personal styling appointment',
  'do you have a student discount',
  'is there parking at your store',
];

if (has('separation')) {
  const top = async (list: string[]): Promise<{ q: string; best: number }[]> => {
    const out: { q: string; best: number }[] = [];
    for (const q of list) {
      const s = await scores(q);
      out.push({ q, best: s[0] ?? 0 });
      await pace();
    }
    return out;
  };

  const yes = await top(ANSWERABLE);
  const no = await top(UNANSWERABLE);
  const fmt = (rows: { q: string; best: number }[]) =>
    rows.map((r) => `    ${r.best.toFixed(3)}  ${r.q}`).join('\n');

  const yesMin = Math.min(...yes.map((r) => r.best));
  const noMax = Math.max(...no.map((r) => r.best));

  console.log(`reranker: ${rerankerKey}`);
  console.log(`\n  ANSWERABLE (want high)\n${fmt(yes)}`);
  console.log(`\n  UNANSWERABLE (want low)\n${fmt(no)}`);
  console.log(
    `\n  answerable min ${yesMin.toFixed(3)} · unanswerable max ${noMax.toFixed(3)} · gap ${(yesMin - noMax).toFixed(3)}`,
  );
  if (reranker.stats) {
    console.log(
      `\n  reranker calls: ${reranker.stats.scored} scored, ${reranker.stats.fellBack} fell back to fusion`,
    );
    if (reranker.stats.fellBack > 0) {
      console.log(
        '  ! fallbacks happened — these numbers are part cosine. Re-run with a larger --pace.',
      );
    }
  }
  console.log(
    yesMin > noMax
      ? `  A decision boundary exists. Any threshold in (${noMax.toFixed(3)}, ${yesMin.toFixed(3)}] separates them.`
      : '  No decision boundary: the ranges overlap. Do not pick a number.',
  );
} else {
  for (const query of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    const hits = await searcher.search({
      query,
      lang: 'en',
      topK: 3,
      minScore: config.retrievalMinScore,
    });
    console.log(`\nQ: ${query}   (threshold ${config.retrievalMinScore}, reranker ${rerankerKey})`);
    if (hits.length === 0) console.log('   — nothing above threshold');
    for (const hit of hits) {
      console.log(
        `   ${hit.score.toFixed(3)}  ${(hit.title ?? '').slice(0, 26).padEnd(26)}  ${hit.content.replace(/\s+/g, ' ').slice(0, 96)}`,
      );
    }
  }
}
console.log(`\ncache: ${embedder.stats.hits} hits, ${embedder.stats.misses} misses`);
await disconnect();
