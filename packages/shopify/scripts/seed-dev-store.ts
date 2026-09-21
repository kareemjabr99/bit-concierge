/**
 * Seeds the Bit68 development store with the fixtures in
 * docs/shopify-dev-store.md.
 *
 * Idempotent: everything it creates is tagged `bitc-seed`, and it looks for
 * that tag before creating anything. Re-running adds nothing.
 *
 *   pnpm --filter @bitc/shopify run seed:check     verify access, nothing written
 *   pnpm --filter @bitc/shopify run seed:dry-run   show the plan, nothing written
 *   pnpm --filter @bitc/shopify run seed           create
 *
 * Run --check first. It confirms the token, the API version and every mutation
 * this script needs actually exist, and reports what is missing rather than
 * failing halfway through writing.
 *
 * **This script uses SHOPIFY_SEED_TOKEN, which carries write scopes.** The
 * agent never sees it: `assertAgentAccessToken` refuses that value in the runtime
 * client by value rather than by variable name, and
 * test/seed-token-isolation.test.ts fails if any runtime file so much as names
 * it. Delete the seed app when seeding is done.
 */

const API_VERSION = '2026-07';
const SEED_TAG = 'bitc-seed';

import { adminToken, diagnose } from './auth.ts';
import {
  ASSIGNED_ORDER_NUMBERS,
  CUSTOMERS,
  describeProduct,
  ORDERS,
  PRODUCTS,
  type SeedOrder,
  type SeedProduct,
} from './seed-data.ts';

const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? '').trim();
const clientId = (process.env.SHOPIFY_CLIENT_ID ?? '').trim();
const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET ?? process.env.SHOPIFY_SEED_TOKEN ?? '')
  .trim()
  .replace(/^['"]|['"]$/g, '');
/** A static shpat_ token, if anyone still has one. Optional. */
const staticToken = (process.env.SHOPIFY_SEED_TOKEN ?? '').trim().startsWith('shpat_')
  ? (process.env.SHOPIFY_SEED_TOKEN ?? '').trim()
  : '';

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--diagnose')
    ? 'diagnose'
    : process.argv.includes('--dry-run')
      ? 'dry-run'
      : 'create';

if (!domain) {
  console.error('SHOPIFY_STORE_DOMAIN must be set in .env.local');
  process.exit(1);
}
if (!staticToken && (!clientId || !clientSecret)) {
  console.error(
    '\nSet SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local.\n\n' +
      '  Apps created in the Dev Dashboard do not hand out a static shpat_ token — that\n' +
      '  flow is gone. The Client ID and the shpss_ Client Secret are exchanged for a\n' +
      '  24-hour token via the client credentials grant, which this script does for you.\n' +
      '  https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens\n',
  );
  process.exit(1);
}

/** Resolved once, then reused. Tokens last 24h and are cached on disk. */
let token = staticToken;
const ensureToken = async (): Promise<string> => {
  // --check mints fresh: a cached token carries the scopes it was minted with,
  // so after a scope change the cache would report the old permissions as
  // current. A check that can be stale is not a check.
  if (!token) token = await adminToken(domain, clientId, clientSecret, { fresh: mode === 'check' });
  return token;
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface GraphQL<T> {
  data?: T;
  errors?: { message: string }[];
}

let calls = 0;

const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
  calls += 1;
  const bearer = await ensureToken();
  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': bearer },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `HTTP ${response.status}. The store rejected the token.\n` +
        `  It was minted from the client credentials grant, so this usually means the app's\n` +
        `  released version does not carry the scope this call needs. Run --check.`,
    );
  }
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);

  const body = (await response.json()) as GraphQL<T>;
  // A GraphQL error arrives with HTTP 200. Treating that as success is the
  // failure-inside-success shape; see docs/where-this-stands.md.
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!body.data) throw new Error('no data in response');
  return body.data;
};

/** Every Shopify mutation returns its own errors in a field rather than throwing. */
const assertNoUserErrors = (label: string, payload: unknown): void => {
  const errors = (payload as { userErrors?: { field?: string[]; message: string }[] })?.userErrors;
  if (errors?.length) {
    throw new Error(
      `${label}: ${errors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`,
    );
  }
};

// ---------------------------------------------------------------------------
// --check: confirm everything before writing anything
// ---------------------------------------------------------------------------

const REQUIRED_MUTATIONS = [
  'productCreate',
  'productVariantsBulkCreate',
  'productVariantsBulkUpdate',
  'inventorySetQuantities',
  'customerCreate',
  'orderCreate',
  'fulfillmentCreate',
  'orderCancel',
  'refundCreate',
  'orderUpdate',
  'orderCustomerSet',
  'orderCustomerRemove',
  'fulfillmentEventCreate',
];

/**
 * Input fields this script actually sends.
 *
 * Checking mutation NAMES is not enough, and that is not hypothetical: the
 * first run passed --check with all nine mutations present, then failed on
 * `ignoreCompareQuantity`, a field that does not exist on
 * InventorySetQuantitiesInput in 2026-07. The check verified the door and not
 * the shape of the key.
 *
 * It failed AFTER creating a product, so the store was left holding one
 * product with no inventory — which is the state --check exists to avoid.
 */
const REQUIRED_INPUT_FIELDS: Record<string, string[]> = {
  InventorySetQuantitiesInput: ['name', 'reason', 'quantities'],
  InventoryQuantityInput: ['inventoryItemId', 'locationId', 'quantity', 'changeFromQuantity'],
  ProductInput: ['handle', 'title', 'descriptionHtml', 'productType', 'status', 'tags'],
  ProductVariantsBulkInput: ['optionValues', 'price', 'inventoryItem', 'inventoryPolicy'],
  CustomerInput: ['email', 'firstName', 'lastName', 'tags'],
  OrderCreateOrderInput: [
    'email',
    'tags',
    'currency',
    'lineItems',
    'shippingAddress',
    'financialStatus',
    'transactions',
  ],
  FulfillmentInput: ['lineItemsByFulfillmentOrder', 'trackingInfo', 'notifyCustomer'],
  RefundInput: ['orderId', 'note', 'notify', 'refundLineItems'],
};

const check = async (): Promise<boolean> => {
  console.log(`\nchecking ${domain} on Admin API ${API_VERSION}\n`);

  const shop = await gql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(
    '{ shop { name currencyCode ianaTimezone } }',
  );
  console.log(`  shop           ${shop.shop.name}`);
  console.log(`  currency       ${shop.shop.currencyCode}`);
  console.log(`  timezone       ${shop.shop.ianaTimezone}`);
  let ok = true;
  if (shop.shop.currencyCode !== 'SAR') {
    console.log(`  ! currency is ${shop.shop.currencyCode}, prices in this script are SAR`);
    ok = false;
  }

  const schema = await gql<{ __type: { fields: { name: string }[] } }>(
    '{ __type(name: "Mutation") { fields(includeDeprecated: false) { name } } }',
  );
  const available = new Set(schema.__type.fields.map((f) => f.name));
  console.log(`\n  mutations this script needs:`);
  for (const name of REQUIRED_MUTATIONS) {
    const present = available.has(name);
    if (!present) ok = false;
    console.log(`    ${present ? 'ok  ' : 'MISSING'} ${name}`);
  }

  // Input fields, not just mutation names. See REQUIRED_INPUT_FIELDS.
  console.log(`\n  input fields this script sends:`);
  for (const [typeName, fields] of Object.entries(REQUIRED_INPUT_FIELDS)) {
    const type = await gql<{ __type: { inputFields: { name: string }[] } | null }>(
      `{ __type(name: "${typeName}") { inputFields { name } } }`,
    );
    if (!type.__type) {
      console.log(`    MISSING ${typeName} (type does not exist)`);
      ok = false;
      continue;
    }
    const present = new Set(type.__type.inputFields.map((f) => f.name));
    const absent = fields.filter((f) => !present.has(f));
    if (absent.length > 0) {
      ok = false;
      console.log(`    MISSING ${typeName}: ${absent.join(', ')}`);
    } else {
      console.log(`    ok   ${typeName} (${fields.length} field(s))`);
    }
  }

  // Scopes. A missing write scope fails halfway through otherwise, leaving the
  // store half-seeded, which is worse than not starting.
  try {
    const scopes = await gql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(
      '{ currentAppInstallation { accessScopes { handle } } }',
    );
    const granted = new Set(scopes.currentAppInstallation.accessScopes.map((s) => s.handle));
    // The four obvious ones, plus the two easy to miss because
    // `write_fulfillments` sounds like it covers them and does not:
    // fulfillmentOrders is gated separately and creating a fulfilment goes
    // through it. Found by the seed failing on "Access denied for
    // fulfillmentOrders field" AFTER creating an order.
    const needed = [
      'write_products',
      'write_customers',
      'write_orders',
      'write_inventory',
      'read_merchant_managed_fulfillment_orders',
      'write_merchant_managed_fulfillment_orders',
    ];
    console.log(`\n  scopes:`);
    for (const scope of needed) {
      const present = granted.has(scope);
      if (!present) ok = false;
      console.log(`    ${present ? 'ok  ' : 'MISSING'} ${scope}`);
    }
  } catch {
    console.log(`\n  ! could not read access scopes`);
  }

  console.log(`\n  ${ok ? 'ready to seed' : 'NOT ready — fix the above first'}\n`);
  return ok;
};

// ---------------------------------------------------------------------------
// Idempotent creation
// ---------------------------------------------------------------------------

/**
 * Sets stock levels, for a product however it got here.
 *
 * Called on both the create and the already-exists path, because the
 * quantities are the point of several scenarios — 2 of the Sadu Hoodie is
 * "low stock", 0 of the Classic Jacket in L is "out of stock" — and a variant
 * sitting at zero by accident is indistinguishable from one sitting at zero on
 * purpose.
 */
const applyInventory = async (
  p: SeedProduct,
  variants: { sku: string; inventoryItem: { id: string } }[],
): Promise<void> => {
  const location = await gql<{ locations: { nodes: { id: string }[] } }>(
    '{ locations(first: 1) { nodes { id } } }',
  );
  const locationId = location.locations.nodes[0]!.id;

  // `changeFromQuantity` is compare-and-set: you state what you believe the
  // current level is, and Shopify refuses if it has moved underneath you.
  //
  // It is REQUIRED, and introspection does not say so — it reports a nullable
  // Int and the requirement is enforced at runtime. So --check cannot catch
  // this class, and did not: it passed with every input field present and the
  // seed still failed on the next line. Worth knowing the limit of that check
  // rather than trusting it further than it goes.
  const current = await gql<{
    nodes: ({
      id: string;
      inventoryLevel: { quantities: { name: string; quantity: number }[] } | null;
    } | null)[];
  }>(
    `query($ids: [ID!]!, $locationId: ID!) {
       nodes(ids: $ids) {
         ... on InventoryItem {
           id
           inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
         }
       }
     }`,
    { ids: variants.map((v) => v.inventoryItem.id), locationId },
  );
  const levelFor = new Map(
    current.nodes
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .map((n) => [n.id, n.inventoryLevel?.quantities[0]?.quantity ?? 0]),
  );

  const quantities = variants
    .filter((v) => p.variants.some((x) => x.sku === v.sku))
    .map((v) => ({
      inventoryItemId: v.inventoryItem.id,
      locationId,
      quantity: p.variants.find((x) => x.sku === v.sku)!.quantity,
      changeFromQuantity: levelFor.get(v.inventoryItem.id) ?? 0,
    }));
  if (quantities.length === 0) return;

  // 2026-07 requires @idempotent on this mutation: inventory is the one thing
  // a retried request must not apply twice. The key is derived from the
  // product and the quantities being set, so re-running this script with the
  // same target is genuinely the same operation and Shopify can say so.
  //
  // Not discoverable from the input types — it is a directive, enforced at
  // runtime, and --check found nothing wrong. Third thing the schema check
  // could not see, after a field that does not exist and a nullable field that
  // is required.
  const idempotencyKey = `bitc-seed-${p.handle}-${quantities
    .map((q) => `${q.inventoryItemId.split('/').pop()}:${q.quantity}`)
    .join(',')}`;
  const inventory = await gql<{ inventorySetQuantities: { userErrors: unknown[] } }>(
    `mutation($input: InventorySetQuantitiesInput!, $key: String!) {
       inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } }
     }`,
    { input: { name: 'available', reason: 'correction', quantities }, key: idempotencyKey },
  );
  assertNoUserErrors(`inventory ${p.handle}`, inventory.inventorySetQuantities);
};

const seedProduct = async (p: SeedProduct): Promise<Map<string, string>> => {
  const existing = await gql<{
    productByHandle: {
      id: string;
      variants: { nodes: { id: string; sku: string; inventoryItem: { id: string } }[] };
    } | null;
  }>(
    `query($handle: String!) {
       productByHandle(handle: $handle) {
         id variants(first: 20) { nodes { id sku inventoryItem { id } } }
       }
     }`,
    { handle: p.handle },
  );

  // A product that exists is not a product that is correct. The first run of
  // this script created this product and then failed before setting inventory,
  // leaving every variant at zero — including the low-stock and out-of-stock
  // scenarios, which would have looked seeded and been wrong. Returning early
  // on "exists" made that state permanent across re-runs.
  if (existing.productByHandle) {
    const variants = existing.productByHandle.variants.nodes;
    if (mode !== 'dry-run') await applyInventory(p, variants);
    console.log(`  = ${p.handle} (exists, inventory reapplied)`);
    return new Map(variants.map((v) => [v.sku, v.id]));
  }
  if (mode === 'dry-run') {
    console.log(`  + ${p.handle} — ${p.variants.length} variant(s), ${p.status}`);
    return new Map();
  }

  const created = await gql<{ productCreate: { product: { id: string }; userErrors: unknown[] } }>(
    `mutation($input: ProductInput!) {
       productCreate(input: $input) { product { id } userErrors { field message } }
     }`,
    {
      input: {
        handle: p.handle,
        title: p.title,
        descriptionHtml: describeProduct(p).replace(/\n/g, '<br>'),
        productType: p.productType,
        status: p.status,
        tags: [SEED_TAG],
        productOptions: [
          { name: p.optionName, values: p.variants.map((v) => ({ name: v.option })) },
        ],
      },
    },
  );
  assertNoUserErrors(`productCreate ${p.handle}`, created.productCreate);
  const productId = created.productCreate.product.id;

  const variants = await gql<{
    productVariantsBulkCreate: {
      productVariants: { id: string; sku: string; inventoryItem: { id: string } }[];
      userErrors: unknown[];
    };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
       productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
         productVariants { id sku inventoryItem { id } }
         userErrors { field message }
       }
     }`,
    {
      productId,
      variants: p.variants.map((v) => ({
        optionValues: [{ optionName: p.optionName, name: v.option }],
        price: v.price,
        inventoryItem: { sku: v.sku, tracked: true },
        inventoryPolicy: v.policy,
      })),
    },
  );
  assertNoUserErrors(`variants ${p.handle}`, variants.productVariantsBulkCreate);

  await applyInventory(p, variants.productVariantsBulkCreate.productVariants);

  console.log(`  + ${p.handle} — ${p.variants.length} variant(s), ${p.status}`);
  return new Map(variants.productVariantsBulkCreate.productVariants.map((v) => [v.sku, v.id]));
};

const seedCustomer = async (c: (typeof CUSTOMERS)[number]): Promise<string | null> => {
  const found = await gql<{ customers: { nodes: { id: string }[] } }>(
    `query($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`,
    { q: `email:${c.email}` },
  );
  if (found.customers.nodes[0]) {
    console.log(`  = ${c.email} (exists)`);
    return found.customers.nodes[0].id;
  }
  if (mode === 'dry-run') {
    console.log(`  + ${c.email}`);
    return null;
  }
  const created = await gql<{
    customerCreate: { customer: { id: string }; userErrors: unknown[] };
  }>(
    `mutation($input: CustomerInput!) {
       customerCreate(input: $input) { customer { id } userErrors { field message } }
     }`,
    {
      input: {
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        tags: [SEED_TAG],
        addresses: [
          {
            city: c.city,
            countryCode: 'SA',
            address1: 'Al-Fursan St',
            firstName: c.firstName,
            lastName: c.lastName,
          },
        ],
      },
    },
  );
  assertNoUserErrors(`customerCreate ${c.email}`, created.customerCreate);
  console.log(`  + ${c.email}`);
  return created.customerCreate.customer.id;
};

interface SeededOrder {
  scenario: string;
  key: string;
  name: string;
  orderEmail: string;
  customerEmail: string | null;
}

/**
 * Brings an order to the state its scenario describes.
 *
 * Split out because an order can exist in the WRONG state: order 1 was created
 * and then its fulfilment failed on a missing scope, leaving a
 * PAID/UNFULFILLED order already tagged as seeded. A re-run would have seen
 * the tag and skipped it for ever — the same "exists is not correct" hole the
 * products path had.
 *
 * Applies only what is actually missing, so calling it on a correct order is
 * free.
 */
const reconcileOrder = async (
  o: SeedOrder,
  orderId: string,
  state?: {
    cancelledAt: string | null;
    displayFulfillmentStatus: string;
    displayFinancialStatus?: string;
    email: string | null;
    customerEmail: string | null;
    refundCount?: number;
  },
): Promise<string[]> => {
  const applied: string[] = [];
  const alreadyFulfilled = state?.displayFulfillmentStatus === 'FULFILLED';
  const alreadyCancelled = Boolean(state?.cancelledAt);
  // Guarded on the refunds themselves. displayFinancialStatus stayed PAID
  // through a zero-value refund, so it is not a signal that a refund happened.
  const alreadyRefunded = (state?.refundCount ?? 0) > 0;

  // The account on the order, which is not the same thing as the email on it.
  //
  // Scenario 4 is the one that needs this and the one that was silently wrong:
  // created without an association, Shopify matched a customer from the order
  // email, so the "different email" case had the same address in both places
  // and tested nothing. Repairable in place — the association is separate from
  // the contact email, which is the very property the scenario exists for.
  if (state && o.customerEmail && state.customerEmail !== o.customerEmail) {
    const wanted = await gql<{ customers: { nodes: { id: string }[] } }>(
      `query($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`,
      { q: `email:${o.customerEmail}` },
    );
    const customerId = wanted.customers.nodes[0]?.id;
    if (customerId) {
      const set = await gql<{ orderCustomerSet: { userErrors: unknown[] } }>(
        `mutation($orderId: ID!, $customerId: ID!) {
           orderCustomerSet(orderId: $orderId, customerId: $customerId) {
             userErrors { field message }
           }
         }`,
        { orderId, customerId },
      );
      assertNoUserErrors(`orderCustomerSet ${o.key}`, set.orderCustomerSet);
      applied.push(`account -> ${o.customerEmail}`);
    }
  }

  // A guest checkout has NO customer record, and orderCreate will not produce
  // one: given an email and no association, Shopify matches or creates a
  // customer and links it. Scenario 6 looked seeded and was not — it had an
  // account with the same address as the order, which is scenario 1 with a
  // different name on it. The association is removed afterwards.
  if (state && o.customerEmail === null && state.customerEmail !== null) {
    const removed = await gql<{ orderCustomerRemove: { userErrors: unknown[] } }>(
      `mutation($orderId: ID!) {
         orderCustomerRemove(orderId: $orderId) { userErrors { field message } }
       }`,
      { orderId },
    );
    assertNoUserErrors(`orderCustomerRemove ${o.key}`, removed.orderCustomerRemove);
    applied.push('account removed (guest)');
  }

  // And the contact email, if it drifted from what the scenario wants.
  if (state && state.email !== o.orderEmail) {
    const updated = await gql<{ orderUpdate: { userErrors: unknown[] } }>(
      `mutation($input: OrderInput!) {
         orderUpdate(input: $input) { order { id } userErrors { field message } }
       }`,
      { input: { id: orderId, email: o.orderEmail } },
    );
    assertNoUserErrors(`orderUpdate ${o.key}`, updated.orderUpdate);
    applied.push(`order email -> ${o.orderEmail}`);
  }

  // Delivery is a separate step from fulfilment, and reachable on its own.
  // Scenario 3 already existed as FULFILLED, so the whole fulfil block was
  // skipped and the delivered event with it — leaving "delivered" identical to
  // "in transit", which is the one thing that scenario is for.
  if (o.fulfil?.delivered && alreadyFulfilled && !alreadyCancelled) {
    const existing = await gql<{
      order: { fulfillments: { id: string; displayStatus: string | null }[] };
    }>(`query($id: ID!) { order(id: $id) { fulfillments(first: 5) { id displayStatus } } }`, {
      id: orderId,
    });
    const pending = existing.order.fulfillments.find((f) => f.displayStatus !== 'DELIVERED');
    if (pending) {
      const event = await gql<{ fulfillmentEventCreate: { userErrors: unknown[] } }>(
        `mutation($input: FulfillmentEventInput!) {
           fulfillmentEventCreate(fulfillmentEvent: $input) {
             fulfillmentEvent { id status }
             userErrors { field message }
           }
         }`,
        {
          input: {
            fulfillmentId: pending.id,
            status: 'DELIVERED',
            message: 'Seed fixture: delivered',
          },
        },
      );
      assertNoUserErrors(`fulfillmentEventCreate ${o.key}`, event.fulfillmentEventCreate);
      applied.push('delivered');
    }
  }

  if (o.fulfil && !alreadyFulfilled && !alreadyCancelled) {
    const fo = await gql<{ order: { fulfillmentOrders: { nodes: { id: string }[] } } }>(
      `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { id } } } }`,
      { id: orderId },
    );
    const fulfillmentOrderId = fo.order.fulfillmentOrders.nodes[0]?.id;
    if (fulfillmentOrderId) {
      const done = await gql<{
        fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: unknown[] };
      }>(
        `mutation($f: FulfillmentInput!) {
           fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { field message } }
         }`,
        {
          f: {
            lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
            trackingInfo: {
              company: o.fulfil.company,
              number: o.fulfil.trackingNumber,
              url: o.fulfil.url,
            },
            notifyCustomer: false,
          },
        },
      );
      assertNoUserErrors(`fulfillmentCreate ${o.key}`, done.fulfillmentCreate);
      applied.push('fulfilment');

      // `delivered` was in the scenario data from the start and nothing read
      // it, so scenario 3 was "fulfilled and in transit" — the same shape as
      // scenario 1. A fulfilment reaches DELIVERED through an event, not a
      // field.
      if (o.fulfil.delivered && done.fulfillmentCreate.fulfillment?.id) {
        const event = await gql<{ fulfillmentEventCreate: { userErrors: unknown[] } }>(
          `mutation($input: FulfillmentEventInput!) {
             fulfillmentEventCreate(fulfillmentEvent: $input) {
               fulfillmentEvent { id status }
               userErrors { field message }
             }
           }`,
          {
            input: {
              fulfillmentId: done.fulfillmentCreate.fulfillment.id,
              status: 'DELIVERED',
              message: 'Seed fixture: delivered',
            },
          },
        );
        assertNoUserErrors(`fulfillmentEventCreate ${o.key}`, event.fulfillmentEventCreate);
        applied.push('delivered');
      }
    }
  }

  if (o.refundSku && !alreadyRefunded && !alreadyCancelled) {
    const detail = await gql<{
      order: {
        lineItems: { nodes: { id: string; sku: string | null; quantity: number }[] };
        transactions: { id: string; kind: string; gateway: string }[];
      };
    }>(
      `query($id: ID!) {
         order(id: $id) {
           lineItems(first: 20) { nodes { id sku quantity } }
           transactions { id kind gateway }
         }
       }`,
      { id: orderId },
    );
    const line = detail.order.lineItems.nodes.find((l) => l.sku === o.refundSku);
    if (line) {
      // A refund without a TRANSACTION moves no money. The first version
      // created a refund of 0.00 against the right line and left the order
      // PAID — a return record, not a partial refund, and
      // displayFinancialStatus never changed, which is also why the
      // "already refunded" guard below could not see it.
      const price = PRODUCTS.flatMap((p) => p.variants).find((v) => v.sku === o.refundSku)?.price;
      if (!price) throw new Error(`${o.key}: no price for ${o.refundSku}`);
      const amount = (Number(price) * line.quantity).toFixed(2);
      const parent = detail.order.transactions.find((t) => t.kind === 'SALE');
      // @idempotent again, for the same reason as inventory: a retried refund
      // must not refund twice. orderCancel does NOT require it — verified by
      // scenario 4 completing without one — so it is not added there
      // speculatively.
      const refunded = await gql<{ refundCreate: { userErrors: unknown[] } }>(
        `mutation($input: RefundInput!, $key: String!) {
           refundCreate(input: $input) @idempotent(key: $key) {
             refund { id }
             userErrors { field message }
           }
         }`,
        {
          // The key includes the AMOUNT. A key that identifies only the
          // scenario means a corrected refund is "the same request" as the
          // wrong one it replaces, and Shopify refuses it — which is the
          // feature working: a fixed payload under an old key is exactly what
          // idempotency is meant to catch.
          key: `bitc-seed-refund-${o.key}-${amount}`,
          input: {
            orderId,
            note: 'Seed fixture: partial refund of one line',
            notify: false,
            // NO_RESTOCK on purpose. RETURN needs a locationId and, worse,
            // would put the item back into stock — and the stock levels are
            // themselves fixtures. A refund quietly changing the low-stock
            // scenario would be one fixture corrupting another.
            refundLineItems: [
              { lineItemId: line.id, quantity: line.quantity, restockType: 'NO_RESTOCK' },
            ],
            ...(parent
              ? {
                  transactions: [
                    {
                      orderId,
                      parentId: parent.id,
                      amount,
                      kind: 'REFUND',
                      gateway: parent.gateway,
                    },
                  ],
                }
              : {}),
          },
        },
      );
      assertNoUserErrors(`refundCreate ${o.key}`, refunded.refundCreate);
      applied.push('refund');
    }
  }

  if (o.cancel && !alreadyCancelled) {
    const cancelled = await gql<{ orderCancel: { userErrors: unknown[] } }>(
      `mutation($id: ID!) {
         orderCancel(orderId: $id, reason: OTHER, refund: true, restock: true, staffNote: "Seed fixture") {
           userErrors { field message }
         }
       }`,
      { id: orderId },
    );
    assertNoUserErrors(`orderCancel ${o.key}`, cancelled.orderCancel);
    applied.push('cancellation');
  }

  return applied;
};

const seedOrder = async (
  o: SeedOrder,
  variantIds: Map<string, string>,
  customerIds: Map<string, string>,
): Promise<SeededOrder | null> => {
  const tag = `${SEED_TAG}-${o.key}`;
  const found = await gql<{
    orders: {
      nodes: {
        id: string;
        name: string;
        email: string | null;
        cancelledAt: string | null;
        displayFulfillmentStatus: string;
        displayFinancialStatus: string;
        customer: { email: string | null } | null;
        refunds: { id: string }[];
      }[];
    };
  }>(
    `query($q: String!) {
       orders(first: 1, query: $q) {
         nodes {
           id name email cancelledAt displayFulfillmentStatus displayFinancialStatus
           customer { email }
           refunds { id }
         }
       }
     }`,
    { q: `tag:${tag}` },
  );
  // Same lesson as products: existing is not correct. Order 1 was created and
  // then its fulfilment failed on a missing scope, leaving a PAID/UNFULFILLED
  // order tagged as seeded — which a re-run would have skipped for ever.
  if (found.orders.nodes[0]) {
    const existing = found.orders.nodes[0];
    let note = 'exists';
    if (mode !== 'dry-run') {
      const applied = await reconcileOrder(o, existing.id, {
        ...existing,
        customerEmail: existing.customer?.email ?? null,
        refundCount: existing.refunds.length,
      });
      if (applied.length > 0) note = `exists, applied ${applied.join(' + ')}`;
    }
    console.log(`  = ${o.scenario} -> ${existing.name} (${note})`);
    return {
      scenario: o.scenario,
      key: o.key,
      name: existing.name,
      orderEmail: existing.email ?? '',
      customerEmail: existing.customer?.email ?? null,
    };
  }
  if (mode === 'dry-run') {
    console.log(`  + ${o.scenario}`);
    return null;
  }

  const lineItems = o.lines.map((l) => ({
    variantId: variantIds.get(l.sku)!,
    quantity: l.quantity,
  }));
  if (lineItems.some((l) => !l.variantId)) {
    throw new Error(`${o.key}: a SKU in this order has no variant — seed products first`);
  }

  // The transaction has to carry an amount, and it has to be the order's.
  // Computed from the prices at the top of this file rather than read back
  // from Shopify, so that a mismatch between the two is a loud failure here
  // rather than a quiet inconsistency the literal gate trips over later.
  const total = o.lines.reduce((sum, line) => {
    const price = PRODUCTS.flatMap((p) => p.variants).find((v) => v.sku === line.sku)?.price;
    if (!price) throw new Error(`${o.key}: no price for ${line.sku}`);
    return sum + Number(price) * line.quantity;
  }, 0);
  const amountSet = { shopMoney: { amount: total.toFixed(2), currencyCode: 'SAR' } };

  // email and customerId are set INDEPENDENTLY, which is the whole point of
  // scenario 4: the order carries k@example.com while the account is omar@.
  // Scenario 6 passes no customerId at all, which is what a guest checkout is.
  const created = await gql<{
    orderCreate: { order: { id: string; name: string }; userErrors: unknown[] };
  }>(
    `mutation($order: OrderCreateOrderInput!) {
       orderCreate(order: $order) { order { id name } userErrors { field message } }
     }`,
    {
      order: {
        // Created with the ACCOUNT's address. Passing a different one here
        // makes Shopify reconcile the two — it matches or creates a customer
        // from the order email and associates THAT, overriding the association
        // above. The differing address is applied afterwards by orderUpdate,
        // which changes only the order's contact email.
        email: o.customerEmail ?? o.orderEmail,
        tags: [SEED_TAG, tag],
        currency: 'SAR',
        // `customer`, not `customerId` — the latter is not a field on this
        // input. It was silently dropped rather than rejected, because
        // JSON.stringify omits undefined, so every order was created with no
        // customer and Shopify matched one from the email instead. That is
        // what destroyed scenario 4: the account became k@example.com, the
        // same address as the order, and the entire point of the case is that
        // they differ.
        ...(o.customerEmail && customerIds.get(o.customerEmail)
          ? { customer: { toAssociate: { id: customerIds.get(o.customerEmail)! } } }
          : {}),
        lineItems,
        shippingAddress: {
          firstName: 'Seed',
          lastName: 'Fixture',
          address1: 'Al-Fursan St',
          city: o.city,
          countryCode: 'SA',
        },
        financialStatus: 'PAID',
        transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'bogus', amountSet }],
      },
    },
  );
  assertNoUserErrors(`orderCreate ${o.key}`, created.orderCreate);
  const orderId = created.orderCreate.order.id;
  const name = created.orderCreate.order.name;

  // Scenario 4: the order's contact email differs from the account's.
  if (o.customerEmail && o.customerEmail !== o.orderEmail) {
    const updated = await gql<{ orderUpdate: { userErrors: unknown[] } }>(
      `mutation($input: OrderInput!) {
         orderUpdate(input: $input) { order { id email } userErrors { field message } }
       }`,
      { input: { id: orderId, email: o.orderEmail } },
    );
    assertNoUserErrors(`orderUpdate ${o.key}`, updated.orderUpdate);
  }

  await reconcileOrder(o, orderId);

  console.log(`  + ${o.scenario} -> ${name}`);
  return {
    scenario: o.scenario,
    key: o.key,
    name,
    orderEmail: o.orderEmail,
    customerEmail: o.customerEmail,
  };
};

// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  if (mode === 'diagnose') {
    console.log(`\ndiagnosing the client credentials grant for ${domain}\n`);
    const result = await diagnose(domain, clientId, clientSecret);
    if (result.ok) {
      console.log('  the grant works. Run --check next.\n');
      return;
    }
    console.log(`  OAuth error: ${result.error}\n`);
    if (result.explanation) console.log(`  ${result.explanation}\n`);
    if (result.nextStep) console.log(`  NEXT: ${result.nextStep}\n`);
    process.exitCode = 1;
    return;
  }

  if (mode === 'check') {
    process.exitCode = (await check()) ? 0 : 1;
    return;
  }

  console.log(
    `\n${mode === 'dry-run' ? 'DRY RUN — nothing will be written' : 'seeding'} ${domain}\n`,
  );

  console.log('products');
  const variantIds = new Map<string, string>();
  for (const p of PRODUCTS) {
    for (const [sku, id] of await seedProduct(p)) variantIds.set(sku, id);
  }

  console.log('\ncustomers');
  const customerIds = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const id = await seedCustomer(c);
    if (id) customerIds.set(c.email, id);
  }

  console.log('\norders');
  const seeded: SeededOrder[] = [];
  for (const o of ORDERS) {
    const result = await seedOrder(o, variantIds, customerIds);
    if (result) seeded.push(result);
  }

  if (mode === 'dry-run') {
    console.log(`\n${calls} read(s) made. Nothing written.\n`);
    return;
  }

  // The remap table. Shopify assigns order numbers and `name` is read-only, so
  // the 16 golden-set cases that hard-code #1886-2041..2045 are remapped from
  // this rather than from guesswork.
  // Re-read rather than report what was seen before reconciling. The first
  // version printed pre-repair state and said scenario 4's account was
  // k@example.com moments after changing it to omar@ — a mapping that is wrong
  // is worse than no mapping, because the remap is done from it.
  const verified = await gql<{
    orders: {
      nodes: {
        name: string;
        email: string | null;
        cancelledAt: string | null;
        displayFinancialStatus: string;
        displayFulfillmentStatus: string;
        customer: { email: string | null } | null;
        fulfillments: { displayStatus: string | null }[];
      }[];
    };
  }>(
    `query($q: String!) {
       orders(first: 20, query: $q) {
         nodes {
           name email cancelledAt displayFinancialStatus displayFulfillmentStatus
           customer { email }
           fulfillments(first: 3) { displayStatus }
         }
       }
     }`,
    { q: `tag:${SEED_TAG}` },
  );
  const live = new Map(verified.orders.nodes.map((n) => [n.name, n]));

  console.log(`\n${'='.repeat(72)}`);
  console.log('ASSIGNED ORDER NUMBERS — read back from the store');
  console.log('='.repeat(72));
  for (const s of seeded) {
    const actual = live.get(s.name);
    const account = actual?.customer?.email ?? null;
    const state = actual
      ? `${actual.displayFinancialStatus}/${actual.displayFulfillmentStatus}` +
        (actual.cancelledAt ? ' CANCELLED' : '') +
        (actual.fulfillments[0]?.displayStatus ? ` (${actual.fulfillments[0].displayStatus})` : '')
      : '(not found)';
    const expected = ASSIGNED_ORDER_NUMBERS[s.key];
    console.log(`\n  ${s.scenario}`);
    console.log(
      `    order number     ${s.name}` +
        // The golden set and the mock fixtures hard-code these. A store that
        // assigns different ones makes both wrong, silently, and the remap was
        // done from this readback.
        (expected && expected !== s.name
          ? `   <- EXPECTED ${expected}. The golden set and packages/shopify/src/mock/fixtures.ts ` +
            `hard-code the expected numbers; update seed-data.ts, then both.`
          : ''),
    );
    console.log(`    state            ${state}`);
    console.log(`    email on order   ${actual?.email ?? s.orderEmail}`);
    console.log(
      `    customer account ${account ?? '(none — guest checkout)'}` +
        (account && account !== actual?.email ? '   <- DIFFERS, on purpose' : ''),
    );
  }
  console.log(`\n${calls} API call(s). Re-running this script changes nothing.\n`);
};

try {
  await main();
} catch (error) {
  // A diagnostic someone reads, not a stack trace. The stack says where the
  // request was made, which is never the useful part here — what went wrong
  // is in the message.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
