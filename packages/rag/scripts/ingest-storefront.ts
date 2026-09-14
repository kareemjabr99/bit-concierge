/**
 * Ingests a public Shopify storefront: policy pages, content pages and product
 * copy. Phase 2 only — Phase 4 replaces this with the Admin API and
 * webhook-driven incremental sync, against the same ingestDocument().
 *
 * Reads nothing but public URLs. Nothing here touches customer data.
 *
 *   pnpm --filter @bitc/rag ingest -- --store https://1886riyadh.com --tenant pk_dev_1886
 *   pnpm --filter @bitc/rag ingest -- --clean corpus/1886/clean --tenant pk_dev_1886
 *
 * --clean ingests merchant-exported plain text instead of crawling. Those
 * documents take precedence over the crawled version of the same policy: an
 * export is cleaner than a page reconstructed from theme markup.
 */
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, createLogger, asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import { resolveEmbedder } from '@bitc/models';
import {
  extractPage,
  deleteDocuments,
  ingestDocument,
  loadCleanText,
  productDocument,
  type IngestDocument,
  type PublicProduct,
} from '../src/index.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const store = arg('store', 'https://1886riyadh.com').replace(/\/$/, '');
const widgetKey = arg('tenant', 'pk_dev_1886');
const productLimit = Number(arg('products', '40'));
const dryRun = flag('dry-run');
// Resolved against the repo root, not the package the script happens to run
// from. The README's command is `--clean corpus/1886/clean`, and a documented
// command that only works from a directory the docs never mention is a
// documented command that does not work.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const cleanArg = arg('clean', '');
const cleanDir = cleanArg ? (isAbsolute(cleanArg) ? cleanArg : join(REPO_ROOT, cleanArg)) : '';

const UA = 'BitConcierge/0.1 (+https://bit68.com; evaluation crawl for a licensed store assistant)';
const logger = createLogger({ level: 'info', write: (l) => process.stderr.write(`${l}\n`) });

const get = async (path: string): Promise<string> => {
  const response = await fetch(`${store}${path}`, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  await new Promise((r) => setTimeout(r, 400));
  return response.text();
};

const POLICIES = ['refund-policy', 'shipping-policy', 'terms-of-service', 'contact-information'];
const PAGES = [
  'shipping-policy',
  'returns-policy',
  'terms-condition',
  'stores',
  'about-us',
  'order-tracking-form',
];
// Per-garment measurement charts. Sampled; the full list is in the pages sitemap.
const SIZE_GUIDES = [
  't-shirt-ss24',
  'classic-t-shirt-unisex-ss24',
  'men-shirt-ss23',
  'wide-fit-trousers-fw23',
  'classic-sweatpants-ss24',
  'classic-jacket-ss24',
  'kids-t-shirt-ss23',
  'japanese-pants',
];

// Resolved up front: superseding a crawled policy happens before the exports
// are ingested, and that needs the tenant.
const models = readEnv('models');
const tenantId = await resolveTenantByWidgetKey(widgetKey);
if (!tenantId) {
  console.error(`No active tenant for "${widgetKey}". Run: pnpm db:seed`);
  process.exit(1);
}
const config = await loadTenantConfig(asTenantId(tenantId));
const embedder = resolveEmbedder(config.embeddingModel, {
  googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
});

const documents: IngestDocument[] = [];
const skipped: string[] = [];
// A Shopify store publishes the same policy at /policies/x and /pages/x. Two
// near-identical chunks fill the top-k between them and crowd out the answer,
// so the first URL wins and the duplicate is recorded rather than indexed.
const seen = new Map<string, string>();
const fingerprint = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 2000);

const addPage = (
  sourceType: IngestDocument['sourceType'],
  id: string,
  path: string,
  html: string,
): void => {
  const page = extractPage(html);
  // A page whose content is rendered client-side extracts to its heading and
  // nothing else. Indexing that is worse than not indexing it: it matches the
  // query and answers nothing.
  if (page.content.replace(/^#+ .*$/gm, '').trim().length < 120) {
    skipped.push(`${path} (no server-rendered content)`);
    return;
  }
  const print = fingerprint(page.content);
  const original = seen.get(print);
  if (original) {
    skipped.push(`${path} (duplicate of ${original})`);
    return;
  }
  seen.set(print, path);

  documents.push({
    sourceType,
    sourceId: id,
    url: `${store}${path}`,
    title: page.title,
    lang: 'en',
    content: page.content,
    metadata: { source: 'public-storefront' },
  });
};

// Merchant exports first, so their fingerprints are in `seen` before the
// crawl runs and the crawled twin of an exported policy is skipped as a
// near-duplicate rather than competing with it in the top-k.
if (cleanDir) {
  const { documents: clean, notes, supersedes } = loadCleanText(cleanDir);
  console.log(`\nmerchant exports from ${cleanDir}`);
  for (const note of notes) {
    const stripped = Object.entries(note.stripped)
      .map(([name, n]) => `${n} ${name}`)
      .join(', ');
    console.log(`  ${note.sourceId.padEnd(24)} "${note.title}"  ${note.chars} chars`);
    if (stripped) console.log(`  ${' '.repeat(24)} stripped: ${stripped}`);
    for (const w of note.warnings) console.log(`  ${' '.repeat(24)} WARNING: ${w}`);
  }
  for (const doc of clean) {
    documents.push(doc);
    seen.set(fingerprint(doc.content), doc.sourceId);
  }
  // The store's other rendering of each exported policy. Deleted before the
  // exports land, so a run cannot leave two answers to the same question in
  // the index even if it is interrupted afterwards.
  if (supersedes.length > 0 && !dryRun) {
    const removed = await deleteDocuments(asTenantId(tenantId), supersedes);
    for (const r of removed)
      console.log(`  superseded ${r.sourceId.padEnd(30)} ${r.chunks} chunks removed`);
    for (const id of supersedes.filter((s) => !removed.some((r) => r.sourceId === s)))
      console.log(`  superseded ${id.padEnd(30)} (not present)`);
  } else if (supersedes.length > 0) {
    for (const id of supersedes) console.log(`  would supersede ${id}`);
  }
  console.log('');
}

if (!flag('clean-only')) {
  for (const slug of POLICIES)
    await addPage(
      'policy',
      `policies/${slug}`,
      `/policies/${slug}`,
      await get(`/policies/${slug}`),
    );
  for (const slug of PAGES)
    await addPage('page', `pages/${slug}`, `/pages/${slug}`, await get(`/pages/${slug}`));
  for (const slug of SIZE_GUIDES)
    await addPage('page', `pages/${slug}`, `/pages/${slug}`, await get(`/pages/${slug}`));
}

const catalogue = flag('clean-only')
  ? { products: [] }
  : (JSON.parse(await get('/products.json?limit=250')) as {
      products: PublicProduct[];
    });
for (const product of catalogue.products.slice(0, productLimit)) {
  const doc = productDocument(product, store);
  documents.push({
    sourceType: 'product',
    sourceId: product.handle,
    url: `${store}/products/${product.handle}`,
    title: doc.title,
    lang: 'en',
    content: doc.content,
    metadata: { source: 'public-storefront', productType: product.product_type },
  });
}

console.log(`fetched ${documents.length} documents (${skipped.length} skipped)`);
for (const s of skipped) console.log(`  skipped  ${s}`);
if (dryRun) {
  for (const d of documents)
    console.log(`  ${d.sourceType.padEnd(8)} ${d.sourceId.padEnd(38)} ${d.content.length} chars`);
  process.exit(0);
}

let created = 0,
  updated = 0,
  unchanged = 0,
  chunks = 0,
  embedded = 0;
for (const doc of documents) {
  try {
    const result = await ingestDocument(asTenantId(tenantId), doc, { embedder });
    chunks += result.chunks;
    embedded += result.embedded;
    if (result.status === 'created') created += 1;
    else if (result.status === 'updated') updated += 1;
    else unchanged += 1;
    console.log(`  ${result.status.padEnd(9)} ${doc.sourceId.padEnd(38)} ${result.chunks} chunks`);
  } catch (error) {
    logger.error('ingest failed', { sourceId: doc.sourceId, error });
    console.log(`  FAILED    ${doc.sourceId}`);
  }
}
console.log(
  `\n${created} created · ${updated} updated · ${unchanged} unchanged · ${chunks} chunks · ${embedded} embedded`,
);
await disconnect();
