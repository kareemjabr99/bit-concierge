import { BitcError } from '@bitc/core';
import { assertNotSeedToken } from './guard.ts';

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
  accessToken: string;
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
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly onThrottle: ((state: ThrottleState) => void) | undefined;

  constructor(options: AdminTransportOptions) {
    // Before anything else: the agent is read-only, and the seed token is not.
    assertNotSeedToken(options.accessToken);
    this.shop = options.shop;
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 4;
    this.onThrottle = options.onThrottle;
  }

  private get endpoint(): string {
    return `https://${this.shop}/admin/api/${this.apiVersion}/graphql.json`;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastError = '';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': this.accessToken,
          accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });

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
        // 401, 403, 404 and the rest. Retrying a revoked token only revokes it
        // more slowly.
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
        if (throttled && attempt < this.maxAttempts) {
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
