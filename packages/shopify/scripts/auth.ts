import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Getting an Admin API token for a Dev Dashboard app.
 *
 * **The classic custom-app flow is gone.** There is no longer a screen that
 * hands you a static `shpat_` token for an app created in the Dev Dashboard —
 * store admin routes you into the dashboard, and the dashboard shows a Client
 * ID and a `shpss_` Client Secret instead. That secret is not a token and will
 * never authenticate an API call, but it is not useless: it is half of the
 * credential pair.
 *
 * The replacement is the **client credentials grant**. POST the pair to the
 * shop's OAuth endpoint and get back a token that lasts 24 hours.
 *
 * The App Automation Token button in the dashboard is a different thing and
 * does not help here: it authenticates the Shopify CLI in CI/CD, not API
 * requests.
 *
 *   https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
 *
 * Tokens are cached on disk because they expire in 24 hours and minting one
 * per script run would be pointless churn. The cache is gitignored and holds a
 * live credential, which is why it is written with an explicit mode.
 */

const CACHE_DIR = join(fileURLToPath(new URL('../../..', import.meta.url)), '.shopify-token-cache');

interface CachedToken {
  accessToken: string;
  scope: string;
  expiresAt: number;
}

export interface OAuthDiagnosis {
  ok: boolean;
  error?: string;
  explanation?: string;
  nextStep?: string;
}

/**
 * What Shopify's OAuth errors actually mean here.
 *
 * The endpoint returns an HTML page with a title like "400 - Oauth error
 * invalid_request" and nothing else — no JSON, no detail, no indication of
 * which of several quite different problems you have. These mappings come from
 * probing the live store with deliberately wrong values to see which error
 * each one produces.
 */
const OAUTH_ERRORS: Record<string, { explanation: string; nextStep: string }> = {
  application_cannot_be_found: {
    explanation: 'The store does not recognise this Client ID at all.',
    nextStep:
      'Check SHOPIFY_CLIENT_ID against the Dev Dashboard app. A typo produces exactly this.',
  },
  invalid_request: {
    explanation:
      'The Client ID is recognised but the store will not issue a token for it. The secret ' +
      'is not even being checked — a deliberately wrong secret produces this same error — ' +
      'so the request is being refused before credential validation. The usual cause is ' +
      'that the app is not INSTALLED on this store: a released version is not an installed one.',
    nextStep:
      'Install bitc-seed on the dev store. In the Dev Dashboard, open the app and use its ' +
      'install link or "Test on development store" and pick this store. Then re-run --check.',
  },
  shop_not_permitted: {
    explanation:
      'The app and the store are in different Dev Dashboard organizations, or the store was ' +
      'created outside the Dev Dashboard. Client credentials only works within one org.',
    nextStep:
      'Confirm the store and the app are both under the Bit68 organization. A dev store made ' +
      'outside the Dev Dashboard cannot use this grant at all.',
  },
  invalid_client: {
    explanation: 'The Client ID is recognised and the Client Secret does not match it.',
    nextStep: 'Re-copy the Client Secret from the Dev Dashboard into SHOPIFY_CLIENT_SECRET.',
  },
};

const parseOAuthError = (html: string): string => {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  return /Oauth error (\w+)/.exec(title)?.[1] ?? 'unknown';
};

const cachePath = (shop: string, clientId: string): string =>
  join(CACHE_DIR, `${shop}.${clientId.slice(0, 8)}.json`);

const readCache = (shop: string, clientId: string): string | null => {
  const path = cachePath(shop, clientId);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as CachedToken;
    // A minute of margin: a token that expires mid-script is worse than one
    // minted a minute early.
    return cached.expiresAt > Date.now() + 60_000 ? cached.accessToken : null;
  } catch {
    return null;
  }
};

const writeCache = (shop: string, clientId: string, token: CachedToken): void => {
  mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  const path = cachePath(shop, clientId);
  // 0600: this file holds a live Admin API credential.
  writeFileSync(path, JSON.stringify(token), { mode: 0o600 });
};

export const diagnose = async (
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthDiagnosis> => {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (response.ok) return { ok: true };

  const error = parseOAuthError(await response.text());
  const known = OAUTH_ERRORS[error];
  return {
    ok: false,
    error,
    ...(known ? { explanation: known.explanation, nextStep: known.nextStep } : {}),
  };
};

/**
 * A token for the shop, minted or from cache.
 *
 * Throws with an explanation rather than an OAuth code, because the code on
 * its own has repeatedly cost hours.
 */
export const adminToken = async (
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<string> => {
  const cached = readCache(shop, clientId);
  if (cached) return cached;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = parseOAuthError(await response.text());
    const known = OAUTH_ERRORS[error];
    throw new Error(
      `Shopify refused the client credentials grant: ${error}\n\n` +
        (known
          ? `  ${known.explanation}\n\n  ${known.nextStep}\n`
          : `  No mapping for this error.\n`),
    );
  }

  const body = (await response.json()) as {
    access_token: string;
    scope: string;
    expires_in: number;
  };
  writeCache(shop, clientId, {
    accessToken: body.access_token,
    scope: body.scope,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
};
