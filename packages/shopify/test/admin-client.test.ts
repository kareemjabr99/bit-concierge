import { describe, expect, it } from 'vitest';
import { AdminTransport, ShopifyAdminClient } from '../src/index.ts';
import { ARCHIVED_MASK, JACKET, SHIPPED_ORDER } from './shapes.ts';

/**
 * The client over a transport whose network is a function.
 *
 * The real transport is used rather than a stub of it, so the retry and
 * throttle behaviour underneath is exercised by the same tests: a client that
 * is correct over a perfect transport and wrong over a throttled one is a
 * client that is wrong in production.
 */

interface Call {
  query: string;
  variables: Record<string, unknown>;
}

const clientOver = (
  responses: unknown[],
  calls: Call[] = [],
): { client: ShopifyAdminClient; calls: Call[] } => {
  let i = 0;
  const transport = new AdminTransport({
    shop: 'test.example',
    accessToken: 'FAKE CREDENTIAL — agent access token',
    apiVersion: '2026-07',
    sleep: async () => {},
    fetchImpl: (async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body) as Call);
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  return { client: new ShopifyAdminClient(transport), calls };
};

const orders = (nodes: unknown[]) => ({ data: { orders: { nodes } } });
const products = (nodes: unknown[]) => ({ data: { products: { nodes } } });

describe('looking an order up by name', () => {
  it('finds it however the customer spelled it', async () => {
    const { client, calls } = clientOver([orders([SHIPPED_ORDER])]);
    const order = await client.getOrderByName(' 1886-1001 ');
    expect(order?.name).toBe('#1886-1001');
    expect(calls[0]?.variables.q).toBe('name:"#1886-1001"');
  });

  it('discards a hit that is not the order asked for', async () => {
    // Shopify's name search is a text match. #1886-10010 contains #1886-1001,
    // and handing back somebody else's order is the worst thing this product
    // could do.
    const { client } = clientOver([orders([{ ...SHIPPED_ORDER, name: '#1886-10010' }])]);
    expect(await client.getOrderByName('#1886-1001')).toBeNull();
  });

  it('refuses to choose when two orders match exactly', async () => {
    const { client } = clientOver([orders([SHIPPED_ORDER, SHIPPED_ORDER])]);
    expect(await client.getOrderByName('#1886-1001')).toBeNull();
  });

  it('returns null for an order that is not there', async () => {
    const { client } = clientOver([orders([])]);
    expect(await client.getOrderByName('#1886-9999')).toBeNull();
  });

  it('escalates rather than reporting no order when Shopify throttles', async () => {
    // The trap this transport exists for: HTTP 200 carrying a THROTTLED error.
    // A client that reads `response.ok` sees success with no data, and tells a
    // customer their order does not exist.
    const throttled = { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] };
    const { client, calls } = clientOver([throttled]);
    await expect(client.getOrderByName('#1886-1001')).rejects.toThrow(/throttled 4 attempts/);
    // It tried, rather than giving up on the first refusal.
    expect(calls).toHaveLength(4);
  });

  it('never turns a transport failure into an empty result', async () => {
    const broken = { errors: [{ message: 'Internal error' }] };
    const { client } = clientOver([broken]);
    await expect(client.getOrderByName('#1886-1001')).rejects.toThrow();
  });
});

describe('customer text reaching a query language', () => {
  it('quotes a search so a field filter cannot be typed into it', async () => {
    // Unquoted, `status:DRAFT` is a filter rather than a search term, and a
    // customer would be querying the merchant's unpublished work.
    const { client, calls } = clientOver([products([])]);
    await client.searchProducts('status:DRAFT tag:private');
    expect(calls[0]?.variables.q).toBe('"status:DRAFT" "tag:private"');
  });

  it('escapes a quote rather than letting it close the literal', async () => {
    const { client, calls } = clientOver([products([])]);
    await client.searchProducts('say "hello"');
    expect(calls[0]?.variables.q).toBe('"say" "\\"hello\\""');
  });

  it('caps how much of a question reaches the query', async () => {
    const { client, calls } = clientOver([products([])]);
    await client.searchProducts(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '));
    expect(String(calls[0]?.variables.q).split(' ')).toHaveLength(12);
  });

  it('quotes the filters too', async () => {
    const { client, calls } = clientOver([products([])]);
    await client.searchProducts('tee', { productType: 'T-Shirts', tag: 'new season' });
    expect(calls[0]?.variables.q).toBe('"tee" product_type:"T-Shirts" tag:"new season"');
  });
});

describe('searching the catalogue', () => {
  const draft = { ...JACKET, handle: 'unreleased', status: 'DRAFT' };

  it('leaves a merchant’s draft out and keeps an archived product in', async () => {
    // A draft is unfinished work — half-priced, half-described. Archived is a
    // thing customers own and ask about.
    const { client } = clientOver([products([draft, ARCHIVED_MASK, JACKET])]);
    const found = await client.searchProducts('anything');
    expect(found.map((p) => p.handle)).toEqual(['1886-mask-black', 'classic-jacket-ss24']);
  });

  it('applies availability and price after fetching, and over-fetches to cover it', async () => {
    const { client, calls } = clientOver([products([ARCHIVED_MASK, JACKET])]);
    const found = await client.searchProducts('anything', { availableOnly: true }, 2);
    expect(found.map((p) => p.handle)).toEqual(['classic-jacket-ss24']);
    expect(calls[0]?.variables.n).toBe(10);
  });

  it('asks for no more than it needs when nothing is filtered afterwards', async () => {
    const { client, calls } = clientOver([products([JACKET])]);
    await client.searchProducts('jacket', {}, 3);
    expect(calls[0]?.variables.n).toBe(3);
  });

  it('honours the limit', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...JACKET, handle: `p${i}` }));
    const { client } = clientOver([products(many)]);
    expect(await client.searchProducts('x', {}, 4)).toHaveLength(4);
  });
});

describe('looking a product up by handle', () => {
  it('matches the handle exactly', async () => {
    const { client, calls } = clientOver([products([JACKET])]);
    expect((await client.getProductByHandle('Classic-Jacket-SS24'))?.title).toBe(
      'Classic Jacket SS24',
    );
    expect(calls[0]?.variables.q).toBe('handle:"classic-jacket-ss24"');
  });

  it('does not accept a near miss', async () => {
    const { client } = clientOver([products([{ ...JACKET, handle: 'classic-jacket-ss25' }])]);
    expect(await client.getProductByHandle('classic-jacket-ss24')).toBeNull();
  });

  it('asks Shopify nothing when given nothing', async () => {
    const { client, calls } = clientOver([products([])]);
    expect(await client.getProductByHandle('   ')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
