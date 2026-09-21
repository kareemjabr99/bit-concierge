/**
 * Reads the development store with the runtime app's credentials and compares
 * it, field by field, against the mock fixtures the eval suite runs on.
 *
 *   pnpm --filter @bitc/shopify run compare:store
 *
 * `test/mock-mirrors-store.test.ts` binds the fixtures to the seed data, which
 * is what the store was *asked* for. This binds them to what the store
 * *returned*, which is a different thing and has already been different three
 * times — a fulfilment reported as FULFILLED rather than IN_TRANSIT, a null
 * variant title, and a second set of totals after a refund. None of those were
 * in the seed script's vocabulary, so nothing derived from it could have
 * noticed.
 *
 * It cannot be a test: it needs credentials and a network, and a suite that
 * needs those is a suite that goes red for reasons that have nothing to do
 * with the code. It is a script someone runs when the store changes, and it
 * exits non-zero, so CI could run it the day there is a credential to give it.
 */

import {
  AdminTransport,
  AccessTokenCache,
  ShopifyAdminClient,
  mockOrders,
  mockProducts,
  type Order,
  type Product,
} from '../src/index.ts';

const API_VERSION = '2026-07';

const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? '').trim();
const clientId = (process.env.SHOPIFY_RUNTIME_CLIENT_ID ?? '').trim();
const clientSecret = (process.env.SHOPIFY_RUNTIME_CLIENT_SECRET ?? '')
  .trim()
  .replace(/^['"]|['"]$/g, '');

if (!domain || !clientId || !clientSecret) {
  console.error(
    '\nSet SHOPIFY_STORE_DOMAIN, SHOPIFY_RUNTIME_CLIENT_ID and ' +
      'SHOPIFY_RUNTIME_CLIENT_SECRET in .env.local.\n\n' +
      '  These are the READ-ONLY runtime app’s credentials, not the seeding app’s.\n',
  );
  process.exit(1);
}

/**
 * Differences that are the point rather than a problem.
 *
 * Each is a way the mock is deliberately not the store, and each can only make
 * the mock a harsher test than the store rather than a kinder one. Listed
 * here so that "we expected that" is a claim written down in advance instead
 * of a judgement made while reading the output.
 */
const EXPECTED_DIFFERENCES: Record<string, string> = {
  id: 'synthetic gids; the store assigns its own',
  url: 'a reserved example domain, so a fixture link can never be fetched — and the store publishes nothing to the Online Store channel, so it says null',
  statusUrl: 'a capability link that opens an order without a login; not committed',
  createdAt: 'seeding time is not order time',
  updatedAt: 'seeding time is not shipment time',
};

interface Difference {
  subject: string;
  field: string;
  mock: unknown;
  store: unknown;
}

const differences: Difference[] = [];
const expected: Difference[] = [];

const compare = (subject: string, field: string, mock: unknown, store: unknown): void => {
  const same = JSON.stringify(mock) === JSON.stringify(store);
  if (same) return;
  const leaf = field.split('.').pop() ?? field;
  (EXPECTED_DIFFERENCES[leaf] ? expected : differences).push({ subject, field, mock, store });
};

const compareOrder = (mock: Order, store: Order): void => {
  const at = `order ${mock.name}`;
  for (const field of [
    'id',
    'name',
    'email',
    'customerEmail',
    'createdAt',
    'financialStatus',
    'fulfillmentStatus',
    'shippingCity',
    'shippingCountryCode',
    'statusUrl',
  ] as const) {
    compare(at, field, mock[field], store[field]);
  }
  // Cancelled-ness rather than the timestamp: one is a fact about the order,
  // the other is a fact about when this store was seeded.
  compare(at, 'cancelled', mock.cancelledAt !== null, store.cancelledAt !== null);
  compare(at, 'totalPrice', mock.totalPrice, store.totalPrice);
  compare(at, 'currentTotalPrice', mock.currentTotalPrice, store.currentTotalPrice);
  compare(at, 'lineItems', mock.lineItems, store.lineItems);

  compare(at, 'fulfillments.length', mock.fulfillments.length, store.fulfillments.length);
  mock.fulfillments.forEach((f, i) => {
    const s = store.fulfillments[i];
    if (!s) return;
    compare(at, `fulfillments[${i}].status`, f.status, s.status);
    compare(at, `fulfillments[${i}].trackingCompany`, f.trackingCompany, s.trackingCompany);
    compare(at, `fulfillments[${i}].trackingNumber`, f.trackingNumber, s.trackingNumber);
    compare(at, `fulfillments[${i}].trackingUrl`, f.trackingUrl, s.trackingUrl);
    compare(at, `fulfillments[${i}].updatedAt`, f.updatedAt, s.updatedAt);
  });
};

const compareProduct = (mock: Product, store: Product): void => {
  const at = `product ${mock.handle}`;
  for (const field of [
    'id',
    'handle',
    'title',
    'description',
    'productType',
    'tags',
    'url',
    'available',
  ] as const) {
    compare(at, field, mock[field], store[field]);
  }
  compare(at, 'priceRange', mock.priceRange, store.priceRange);
  compare(at, 'variants.length', mock.variants.length, store.variants.length);
  mock.variants.forEach((v, i) => {
    const s = store.variants[i];
    if (!s) return;
    for (const field of [
      'id',
      'title',
      'sku',
      'price',
      'available',
      'inventoryQuantity',
      'inventoryPolicy',
      'selectedOptions',
    ] as const) {
      compare(at, `variants[${v.sku ?? i}].${field}`, v[field], s[field]);
    }
  });
};

const main = async (): Promise<void> => {
  const token = await new AccessTokenCache().token(domain, clientId, clientSecret);
  const client = new ShopifyAdminClient(
    new AdminTransport({ shop: domain, accessToken: token, apiVersion: API_VERSION }),
  );

  console.log(`\nReading ${domain} at ${API_VERSION}\n`);

  let missing = 0;
  for (const mock of mockOrders) {
    const store = await client.getOrderByName(mock.name);
    if (!store) {
      console.log(`  MISSING  ${mock.name} is in the fixtures and not in the store`);
      missing += 1;
      continue;
    }
    compareOrder(mock, store);
    console.log(`  read     ${mock.name}`);
  }

  for (const mock of mockProducts) {
    const store = await client.getProductByHandle(mock.handle);
    if (!store) {
      console.log(`  MISSING  ${mock.handle} is in the fixtures and not in the store`);
      missing += 1;
      continue;
    }
    compareProduct(mock, store);
    console.log(`  read     ${mock.handle}`);
  }

  /**
   * A difference that is only whitespace has one known cause, so it names it.
   *
   * Shopify's `description` is `descriptionHtml` with the tags removed and
   * nothing put in their place, so a `<br>` with no newline beside it closes
   * the gap between two lines and runs them together. Worth saying out loud in
   * the output: the two strings look identical at a glance and the diff is
   * three missing characters in the middle of a paragraph.
   */
  const whitespaceOnly = (d: Difference): boolean =>
    typeof d.mock === 'string' &&
    typeof d.store === 'string' &&
    d.mock.replace(/\s+/g, '') === d.store.replace(/\s+/g, '');

  const show = (d: Difference) =>
    console.log(
      `    ${d.subject} · ${d.field}\n` +
        `      mock  ${JSON.stringify(d.mock)}\n` +
        `      store ${JSON.stringify(d.store)}` +
        (whitespaceOnly(d)
          ? `\n      ONLY WHITESPACE — the store's copy is missing line breaks. Shopify strips\n` +
            `      HTML tags out of \`description\` without substituting anything, so a <br>\n` +
            `      with no newline beside it joins two lines. Fixed in seed-dev-store.ts;\n` +
            `      the store keeps the old copy until it is seeded again.`
          : ''),
    );

  console.log(`\n${'='.repeat(72)}`);
  if (expected.length > 0) {
    console.log(`\n${expected.length} difference(s) that are deliberate:\n`);
    for (const d of expected) {
      console.log(
        `    ${d.subject} · ${d.field} — ${EXPECTED_DIFFERENCES[d.field.split('.').pop()!]}`,
      );
    }
  }

  if (differences.length === 0 && missing === 0) {
    console.log('\nThe mock is the store. Every field the agent can read agrees.\n');
    return;
  }

  console.log(`\n${differences.length} difference(s) that are not:\n`);
  differences.forEach(show);
  console.log(
    `\nThe eval suite runs against the mock and an acceptance run runs against the store.\n` +
      `While these disagree, a green suite is a claim about the mock and nothing else.\n`,
  );
  process.exit(1);
};

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
