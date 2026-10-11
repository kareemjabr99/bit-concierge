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
const mintToken = async () => 'FAKE CREDENTIAL — access token';

describe('the Shopify client factory', () => {
  it('builds the real client when all three runtime variables are set', async () => {
    const c = await createShopifyClient(FULL, { mintToken });
    expect(c.kind).toBe('real');
    expect(c.client).toBeInstanceOf(ShopifyAdminClient);
    expect(c.client).not.toBeInstanceOf(MockShopifyClient);
    expect(c.label).toContain('dev-store.example.myshopify.com');
  });

  it('builds the mock, and says so, when none are set', async () => {
    const c = await createShopifyClient({}, { mintToken });
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
    expect((await createShopifyClient(env, { mintToken })).kind).toBe('mock');
  });

  it.each(Object.keys(FULL))(
    'refuses to fall back to the mock when %s alone is missing',
    async (name) => {
      const env = { ...FULL, [name]: undefined };
      await expect(createShopifyClient(env, { mintToken })).rejects.toThrow(/half configured/);
    },
  );

  it.each(Object.keys(FULL))(
    'refuses to fall back to the mock when only %s is set',
    async (name) => {
      const env = { [name]: FULL[name as keyof typeof FULL] };
      await expect(createShopifyClient(env, { mintToken })).rejects.toThrow(/half configured/);
    },
  );

  it('names what is missing and never prints a value', async () => {
    const env = { ...FULL, SHOPIFY_RUNTIME_CLIENT_SECRET: undefined };
    const error = await createShopifyClient(env, { mintToken }).catch((e: Error) => e);
    expect((error as Error).message).toContain('SHOPIFY_RUNTIME_CLIENT_SECRET');
    expect((error as Error).message).not.toContain('FAKE CREDENTIAL');
  });

  it('lets a refused grant fail the start rather than falling back to the mock', async () => {
    const refused = async () => {
      throw new Error('shopify_auth_failed');
    };
    await expect(createShopifyClient(FULL, { mintToken: refused })).rejects.toThrow(
      /shopify_auth_failed/,
    );
  });

  it('refuses the mock in production, where no store configured is a mistake', async () => {
    await expect(createShopifyClient({ NODE_ENV: 'production' }, { mintToken })).rejects.toThrow(
      /production/,
    );
  });

  it('does not read the seeding credentials, even when they are all that is set', async () => {
    const env = { SHOPIFY_CLIENT_ID: 'x', SHOPIFY_CLIENT_SECRET: 'y', SHOPIFY_SEED_TOKEN: 'z' };
    expect((await createShopifyClient(env, { mintToken })).kind).toBe('mock');
  });
});
