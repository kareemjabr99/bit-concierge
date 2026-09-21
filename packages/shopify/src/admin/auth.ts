import { BitcError } from '@bitc/core';
import { assertAgentAccessToken } from './guard.ts';

/**
 * Getting an Admin API token for a Dev Dashboard app.
 *
 * **The classic custom-app flow is gone.** There is no screen that hands out a
 * static `shpat_` token any more; an app created in the Dev Dashboard has a
 * Client ID and a `shpss_` Client Secret, and the secret is exchanged for a
 * 24-hour token through the client credentials grant. The secret is not a
 * token and will never authenticate a request.
 *
 *   https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
 *
 * Credentials are arguments, never read from the environment here. This file
 * runs in the runtime, where a tenant's credentials come from that tenant's
 * row rather than from a process-wide variable — and a module that reaches for
 * `process.env` is a module that serves one tenant correctly and the rest by
 * accident.
 */

export interface GrantResult {
  accessToken: string;
  /** Comma-separated, as Shopify returns it. */
  scope: string;
  expiresInSeconds: number;
}

/** Shopify answers an OAuth failure with an HTML page. The code is in its title. */
export const parseOAuthError = (html: string): string => {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  return /Oauth error (\w+)/.exec(title)?.[1] ?? 'unknown';
};

/**
 * One client credentials grant. No caching, no retries, no interpretation.
 *
 * Shared with the seeding script so there is a single implementation of the
 * exchange. Everything around it differs — the seed script caches on disk and
 * maps the opaque error codes to instructions; the runtime caches in memory
 * and escalates — but the exchange itself should not be written twice and then
 * drift.
 */
export const requestAccessToken = async (
  shop: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ ok: true; grant: GrantResult } | { ok: false; error: string }> => {
  const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) return { ok: false, error: parseOAuthError(await response.text()) };

  const body = (await response.json()) as {
    access_token: string;
    scope: string;
    expires_in: number;
  };
  return {
    ok: true,
    grant: {
      accessToken: body.access_token,
      scope: body.scope,
      expiresInSeconds: body.expires_in,
    },
  };
};

interface CacheEntry {
  token: string;
  expiresAt: number;
}

/**
 * Tokens, minted on demand and reused until they are nearly stale.
 *
 * In memory rather than on disk. A runtime process holding a live Admin
 * credential in a file is a credential that outlives the process, and the only
 * thing it saves is one request per day per tenant.
 *
 * The margin matters more than it looks: a token that expires mid-request
 * fails a customer's order lookup, and the retry costs a second round trip at
 * exactly the moment someone is waiting.
 */
export class AccessTokenCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly marginMs: number;

  constructor(now: () => number = Date.now, marginMs = 5 * 60 * 1000) {
    this.now = now;
    this.marginMs = marginMs;
  }

  /** Discards a token the API has just rejected, so the next call mints one. */
  invalidate(shop: string, clientId: string): void {
    this.entries.delete(`${shop}:${clientId}`);
  }

  async token(shop: string, clientId: string, clientSecret: string): Promise<string> {
    const key = `${shop}:${clientId}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now() + this.marginMs) return cached.token;

    const result = await requestAccessToken(shop, clientId, clientSecret);
    if (!result.ok) {
      // The OAuth code alone has repeatedly cost hours, so it is carried; the
      // credential never is.
      throw new BitcError(
        'shopify_auth_failed',
        `Shopify refused the client credentials grant for ${shop}: ${result.error}`,
        { customerSafe: false },
      );
    }

    // The agent is read-only. A seeding credential, or this app's own client
    // secret, arriving here as though it were a token is refused by value.
    assertAgentAccessToken(result.grant.accessToken);

    this.entries.set(key, {
      token: result.grant.accessToken,
      expiresAt: this.now() + result.grant.expiresInSeconds * 1000,
    });
    return result.grant.accessToken;
  }
}
