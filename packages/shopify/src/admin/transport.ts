import { BitcError } from '@bitc/core';
import { assertAgentAccessToken } from './guard.ts';
import type { AccessTokenSource } from './auth.ts';

/**
 * HTTP for the Admin GraphQL API: retries, throttling, and knowing when to stop.
 *
 * Shopify's Admin API is **cost-based**, not request-based. Each query draws a
 * computed cost from a bucket that refills at a fixed rate, and one expensive
 * query can empty it. The response carries the bucket state, so the honest
 * thing is to read it and slow down before being refused rather than after.
 *
 * The rule that matters more than any of the mechanics: **a lookup that cannot
 * complete must escalate, never guess.** "Where is my order" answered from a
 * stale cache or an optimistic default is precisely the failure this product
 * exists not to have. This layer succeeds or fails clearly. It never invents a
 * result.
 */

export interface ThrottleState {
  /** Points left in the bucket, from the response's cost extension. */
  available: number;
  maximum: number;
  restoreRatePerSecond: number;
}

export interface AdminTransportOptions {
  shop: string;
  /**
   * A fixed token (a CLI session, a script, a test) or a source that renews
   * (anything that stays up longer than the token lasts). Only a source is
   * retried after a 401: asking again for the same fixed string gets the same
   * refusal.
   */
  accessToken: string | AccessTokenSource;
  apiVersion: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests so retry delays do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Called with the bucket state after every query that returns one. */
  onThrottle?: (state: ThrottleState) => void;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/** Retryable: the request might work if tried again. Nothing else is. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class AdminTransport {
  private readonly shop: string;
  private readonly tokens: AccessTokenSource;
  private readonly renewable: boolean;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly onThrottle: ((state: ThrottleState) => void) | undefined;

  constructor(options: AdminTransportOptions) {
    // Before anything else: the agent is read-only, and the seed token is not.
    // A source's tokens are checked as they arrive, in send().
    const fixed = options.accessToken;
    if (typeof fixed === 'string') {
      assertAgentAccessToken(fixed);
      this.tokens = { token: async () => fixed, invalidate: () => {} };
      this.renewable = false;
    } else {
      this.tokens = fixed;
      this.renewable = true;
    }
    this.shop = options.shop;
    this.apiVersion = options.apiVersion;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 4;
    this.onThrottle = options.onThrottle;
  }

  private get endpoint(): string {
    return `https://${this.shop}/admin/api/${this.apiVersion}/graphql.json`;
  }

  private async post(body: string): Promise<Response> {
    const token = await this.tokens.token();
    assertAgentAccessToken(token);
    return this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': token,
        accept: 'application/json',
      },
      body,
    });
  }

  /**
   * One request, and one more if a renewable token was refused. Shopify can
   * revoke a token before the expiry it announced (an app reinstalled, a
   * secret rotated); the cache would keep handing it out until that expiry,
   * so a 401 discards it and mints once. A second 401 is a real refusal and
   * falls through to the caller as one. Kept out of the retry loop so it never
   * spends one of the throttle attempts.
   */
  private async send(body: string): Promise<Response> {
    const response = await this.post(body);
    if (response.status !== 401 || !this.renewable) return response;
    this.tokens.invalidate();
    return this.post(body);
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastError = '';
    const payload = JSON.stringify({ query, variables });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.send(payload);

      if (RETRYABLE_STATUS.has(response.status)) {
        lastError = `HTTP ${response.status}`;
        if (attempt === this.maxAttempts) break;
        // Retry-After is authoritative on a 429: Shopify knows when the bucket
        // refills and we are guessing.
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250,
        );
        continue;
      }

      if (!response.ok) {
        // 401 (after send() renewed once), 403, 404 and the rest. Retrying a
        // revoked token only revokes it more slowly.
        throw new BitcError(
          `shopify_http_${response.status}`,
          `Shopify returned ${response.status}`,
          { customerSafe: false },
        );
      }

      const body = (await response.json()) as GraphQLResponse<T>;
      const bucket = body.extensions?.cost?.throttleStatus;
      if (bucket) {
        this.onThrottle?.({
          available: bucket.currentlyAvailable,
          maximum: bucket.maximumAvailable,
          restoreRatePerSecond: bucket.restoreRate,
        });
      }

      if (body.errors?.length) {
        // GraphQL reports throttling as a 200 with an error code. That is the
        // trap: a naive client sees 200 and reports success with no data.
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt === this.maxAttempts) {
          // Out of attempts against a bucket that never refilled. Named apart
          // from a GraphQL error because the two call for opposite responses:
          // this one is a busy store and will pass, a malformed query is a bug
          // and will not. One message for both sends whoever reads the log
          // hunting the wrong thing.
          throw new BitcError(
            'shopify_throttled',
            `Shopify throttled ${this.maxAttempts} attempts in a row`,
            { customerSafe: false },
          );
        }
        if (throttled) {
          lastError = 'THROTTLED';
          // Wait for the bucket to refill to half, which is long enough to be
          // worth retrying and short enough not to strand a customer.
          const wait = bucket
            ? Math.max(
                1000,
                ((bucket.maximumAvailable / 2 - bucket.currentlyAvailable) /
                  Math.max(bucket.restoreRate, 1)) *
                  1000,
              )
            : 2 ** attempt * 250;
          await this.sleep(wait);
          continue;
        }
        throw new BitcError('shopify_graphql_error', body.errors.map((e) => e.message).join('; '), {
          customerSafe: false,
        });
      }

      if (!body.data) {
        throw new BitcError('shopify_empty_response', 'Shopify returned no data', {
          customerSafe: false,
        });
      }
      return body.data;
    }

    // Out of attempts. This becomes a tool error, which becomes an escalation.
    // It must never become an answer.
    throw new BitcError(
      'shopify_unavailable',
      `Shopify did not respond after ${this.maxAttempts} attempts (${lastError})`,
      { customerSafe: false },
    );
  }
}
