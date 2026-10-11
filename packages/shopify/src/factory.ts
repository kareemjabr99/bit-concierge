import { ConfigError } from '@bitc/core';
import { MockShopifyClient } from './mock/client.ts';
import { AccessTokenCache } from './admin/auth.ts';
import { AdminTransport } from './admin/transport.ts';
import { ShopifyAdminClient } from './admin/client.ts';
import type { ShopifyReadClient } from './types.ts';

/**
 * Which store a conversation talks to — decided once, at the edge, from the
 * environment it is handed. Shared by every entry point (the CLI, the eval
 * runner) so none of them can choose differently.
 *
 * Credentials are arguments in `packages/shopify/src` and never `process.env`
 * reads, so the read happens here and the package stays ignorant of where
 * they came from.
 *
 * **The mock may stand in only when nothing was asked for.** The three runtime
 * variables all absent is a deliberate offline run. Anything else that is not a
 * working real client — one variable missing, a token the store refused, a
 * production process with no store configured — is an error and never a quiet
 * substitution. A conversation answered from the mock looks exactly like one
 * answered from the store, and this is the one component where "looks the same"
 * is the failure: `compare:store` exists because the mock was wrong once in a
 * way nothing else could see.
 */

const API_VERSION = '2026-07';

/** The runtime app's variables. The seeding app's are never read here. */
const REQUIRED = [
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_RUNTIME_CLIENT_ID',
  'SHOPIFY_RUNTIME_CLIENT_SECRET',
] as const;

export interface ShopifyConnection {
  client: ShopifyReadClient;
  kind: 'real' | 'mock';
  /** One line for the top of a transcript, so no run is ambiguous about its store. */
  label: string;
}

export interface ShopifyFactoryOptions {
  /** Injected in tests so the real path never touches the network. */
  mintToken?: (shop: string, clientId: string, clientSecret: string) => Promise<string>;
}

/** `.env` files collect whitespace and quotes, and neither is part of a value. */
const clean = (value: string | undefined): string =>
  (value ?? '').trim().replace(/^['"]|['"]$/g, '');

export const createShopifyClient = async (
  env: Record<string, string | undefined>,
  options: ShopifyFactoryOptions = {},
): Promise<ShopifyConnection> => {
  const values = Object.fromEntries(REQUIRED.map((name) => [name, clean(env[name])]));
  const present = REQUIRED.filter((name) => values[name] !== '');
  const missing = REQUIRED.filter((name) => values[name] === '');

  if (present.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new ConfigError(
        `No Shopify store is configured in production. Set ${REQUIRED.join(', ')}; ` +
          'the mock does not stand in for a store a customer is asking about.',
      );
    }
    return {
      client: new MockShopifyClient(),
      kind: 'mock',
      label: 'MOCK store — synthetic data, no Shopify variables set',
    };
  }

  if (missing.length > 0) {
    // Half a configuration is a mistake, not a request for the mock.
    throw new ConfigError(
      `Shopify is half configured: ${missing.join(', ')} not set, ${present.join(', ')} set. ` +
        'Set all three for the real store or none for the mock.',
      { missing },
    );
  }

  const shop = values.SHOPIFY_STORE_DOMAIN!;
  const mint =
    options.mintToken ?? ((s, id, secret) => new AccessTokenCache().token(s, id, secret));
  // A refused grant propagates. There is deliberately no catch here.
  const accessToken = await mint(
    shop,
    values.SHOPIFY_RUNTIME_CLIENT_ID!,
    values.SHOPIFY_RUNTIME_CLIENT_SECRET!,
  );

  return {
    client: new ShopifyAdminClient(
      new AdminTransport({ shop, accessToken, apiVersion: API_VERSION }),
    ),
    kind: 'real',
    label: `REAL store ${shop} (Admin API ${API_VERSION}, read-only)`,
  };
};
