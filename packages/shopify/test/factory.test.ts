import { describe, expect, it } from 'vitest';
import { MockShopifyClient, ShopifyAdminClient, createShopifyClient } from '../src/index.ts';

/**
 * The mock must never stand in for the real store unless nothing was asked
 * for. Every test here that expects a throw also asserts that no client was
 * built, because the failure being guarded is a conversation that carries on
 * quietly against synthetic data.
 */

const FULL = {
  SHOPIFY_STORE_DOMAIN: 'dev-store.example.myshopify.com',
  SHOPIFY_RUNTIME_CLIENT_ID: 'FAKE CREDENTIAL — client id',
  SHOPIFY_RUNTIME_CLIENT_SECRET: 'FAKE CREDENTIAL — client secret',
};
const grant = (accessToken = 'FAKE CREDENTIAL — access token', expiresInSeconds = 86_400) =>
  ({ ok: true, grant: { accessToken, scope: 'read_orders', expiresInSeconds } }) as const;
const requestToken = async () => grant();

describe('the Shopify client factory', () => {
  it('builds the real client when all three runtime variables are set', async () => {
    const c = await createShopifyClient(FULL, { requestToken });
    expect(c.kind).toBe('real');
    expect(c.client).toBeInstanceOf(ShopifyAdminClient);
    expect(c.client).not.toBeInstanceOf(MockShopifyClient);
    expect(c.label).toContain('dev-store.example.myshopify.com');
  });

  it('builds the mock, and says so, when none are set', async () => {
    const c = await createShopifyClient({}, { requestToken });
    expect(c.kind).toBe('mock');
    expect(c.client).toBeInstanceOf(MockShopifyClient);
    expect(c.label).toMatch(/MOCK/);
  });

  it('treats empty and whitespace-only values as unset', async () => {
    // A copied .env.example leaves `KEY=` behind, which means unset.
    const env = {
      SHOPIFY_STORE_DOMAIN: '',
      SHOPIFY_RUNTIME_CLIENT_ID: '  ',
      SHOPIFY_RUNTIME_CLIENT_SECRET: "''",
    };
    expect((await createShopifyClient(env, { requestToken })).kind).toBe('mock');
  });

  it.each(Object.keys(FULL))(
    'refuses to fall back to the mock when %s alone is missing',
    async (name) => {
      const env = { ...FULL, [name]: undefined };
      await expect(createShopifyClient(env, { requestToken })).rejects.toThrow(/half configured/);
    },
  );

  it.each(Object.keys(FULL))(
    'refuses to fall back to the mock when only %s is set',
    async (name) => {
      const env = { [name]: FULL[name as keyof typeof FULL] };
      await expect(createShopifyClient(env, { requestToken })).rejects.toThrow(/half configured/);
    },
  );

  it('names what is missing and never prints a value', async () => {
    const env = { ...FULL, SHOPIFY_RUNTIME_CLIENT_SECRET: undefined };
    const error = await createShopifyClient(env, { requestToken }).catch((e: Error) => e);
    expect((error as Error).message).toContain('SHOPIFY_RUNTIME_CLIENT_SECRET');
    expect((error as Error).message).not.toContain('FAKE CREDENTIAL');
  });

  it('lets a refused grant fail the start rather than falling back to the mock', async () => {
    const refused = async () => ({ ok: false, error: 'invalid_client' }) as const;
    await expect(createShopifyClient(FULL, { requestToken: refused })).rejects.toThrow(
      /refused the client credentials grant.*invalid_client/,
    );
  });

  it('refuses the mock in production, where no store configured is a mistake', async () => {
    await expect(createShopifyClient({ NODE_ENV: 'production' }, { requestToken })).rejects.toThrow(
      /production/,
    );
  });

  it('does not read the seeding credentials, even when they are all that is set', async () => {
    const env = { SHOPIFY_CLIENT_ID: 'x', SHOPIFY_CLIENT_SECRET: 'y', SHOPIFY_SEED_TOKEN: 'z' };
    expect((await createShopifyClient(env, { requestToken })).kind).toBe('mock');
  });

  /**
   * The server case. A client built once and asked again after the token's
   * 24 hours must ask with a new token — before the store refuses the old one,
   * not after. Run through the factory because the factory is where a fixed
   * string could be wired in again, and nothing below it would notice.
   */
  describe('a client that outlives its token', () => {
    const orderSearch = (): Response =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: { orders: { nodes: [] } } }),
      }) as Response;
    const refusedToken = (): Response =>
      ({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) }) as Response;

    const build = async (responses: (() => Response)[] = []) => {
      let clock = Date.parse('2026-10-18T09:00:00Z');
      let minted = 0;
      const sent: string[] = [];
      const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
        sent.push(init.headers['x-shopify-access-token']!);
        return (responses.shift() ?? orderSearch)();
      }) as unknown as typeof fetch;
      const c = await createShopifyClient(FULL, {
        now: () => clock,
        fetchImpl,
        requestToken: async () => grant(`FAKE CREDENTIAL — token ${(minted += 1)}`),
      });
      return { c, sent, advance: (ms: number) => (clock += ms), minted: () => minted };
    };

    it('mints once at start and reuses the token while it is fresh', async () => {
      const { c, sent, advance, minted } = await build();
      await c.client.getOrderByName('#1886-1001');
      advance(23 * 3600_000);
      await c.client.getOrderByName('#1886-1001');
      expect(minted()).toBe(1);
      expect(sent).toEqual(['FAKE CREDENTIAL — token 1', 'FAKE CREDENTIAL — token 1']);
    });

    it('renews before the token expires, on day two', async () => {
      const { c, sent, advance } = await build();
      advance(24 * 3600_000 - 60_000); // a minute left: inside the renewal margin
      await c.client.getOrderByName('#1886-1001');
      expect(sent).toEqual(['FAKE CREDENTIAL — token 2']);
    });

    it('re-mints once when the store refuses a token early, and the lookup succeeds', async () => {
      const { c, sent } = await build([refusedToken]);
      expect(await c.client.getOrderByName('#1886-1001')).toBeNull();
      expect(sent).toEqual(['FAKE CREDENTIAL — token 1', 'FAKE CREDENTIAL — token 2']);
    });

    it('gives up after the second refusal rather than minting forever', async () => {
      const { c, sent } = await build([refusedToken, refusedToken, refusedToken]);
      await expect(c.client.getOrderByName('#1886-1001')).rejects.toThrow(/401/);
      expect(sent).toHaveLength(2);
    });
  });
});
