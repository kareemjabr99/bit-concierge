import { describe, expect, it, vi } from 'vitest';
import {
  AdminTransport,
  type AdminTransportOptions,
  type ThrottleState,
} from '../src/admin/transport.ts';

/**
 * The property under test throughout: **a lookup that cannot complete must
 * fail, not guess.** Everything else here is mechanics in service of that.
 */

const ok = (data: unknown, extensions?: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ data, ...(extensions ? { extensions } : {}) }),
  }) as Response;

const gql = (errors: unknown[], extensions?: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ errors, ...(extensions ? { extensions } : {}) }),
  }) as Response;

const http = (status: number, headers: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => ({}),
  }) as Response;

const cost = (available: number, maximum = 2000, restoreRate = 100) => ({
  cost: {
    throttleStatus: { currentlyAvailable: available, maximumAvailable: maximum, restoreRate },
  },
});

const transport = (responses: Response[], over: Partial<AdminTransportOptions> = {}) => {
  const slept: number[] = [];
  const fetchImpl = vi.fn(async () => responses.shift() ?? http(500));
  const t = new AdminTransport({
    shop: 'bitc-dev.myshopify.com',
    accessToken: 'FAKE CREDENTIAL — not a real token 2',
    apiVersion: '2026-07',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => void slept.push(ms),
    ...over,
  });
  return { t, fetchImpl, slept };
};

describe('a successful query', () => {
  it('returns the data', async () => {
    const { t } = transport([ok({ order: { name: '#1886-1001' } })]);
    expect(await t.query<{ order: { name: string } }>('{ order }')).toEqual({
      order: { name: '#1886-1001' },
    });
  });

  it('sends the token in the header and never in the body or URL', async () => {
    // A token in a URL reaches an access log. A token in a body reaches
    // whatever logs bodies.
    const { t, fetchImpl } = transport([ok({})]);
    await t.query('{ shop }');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('FAKE CREDENTIAL');
    expect(String(init.body)).not.toContain('FAKE CREDENTIAL');
    expect((init.headers as Record<string, string>)['x-shopify-access-token']).toBe(
      'FAKE CREDENTIAL — not a real token 2',
    );
  });

  it('reports the throttle bucket so a caller can slow down before being refused', async () => {
    const seen: ThrottleState[] = [];
    const { t } = transport([ok({}, cost(1400))], { onThrottle: (s) => seen.push(s) });
    await t.query('{ shop }');
    expect(seen).toEqual([{ available: 1400, maximum: 2000, restoreRatePerSecond: 100 }]);
  });
});

describe('throttling', () => {
  it('retries a GraphQL THROTTLED error, which arrives as a 200', async () => {
    // The trap: Shopify reports throttling with HTTP 200 and an error code. A
    // client that checks response.ok reports success with no data.
    const { t, fetchImpl } = transport([
      gql([{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], cost(5)),
      ok({ order: { name: '#1886-1001' } }),
    ]);
    expect(await t.query('{ order }')).toEqual({ order: { name: '#1886-1001' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits for the bucket to refill rather than a fixed backoff', async () => {
    // 5 of 2000 points at 100/sec: half the bucket is ~9.95 seconds away.
    const { t, slept } = transport([
      gql([{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], cost(5)),
      ok({}),
    ]);
    await t.query('{ shop }');
    expect(slept[0]).toBeGreaterThan(9000);
  });

  it('honours Retry-After on a 429 instead of guessing', async () => {
    const { t, slept } = transport([http(429, { 'retry-after': '7' }), ok({})]);
    await t.query('{ shop }');
    expect(slept).toEqual([7000]);
  });

  it('gives up after the attempt limit and throws rather than returning nothing', async () => {
    // The whole point. An exhausted retry budget becomes a tool error, which
    // becomes an escalation. It must never become an answer.
    const { t, fetchImpl } = transport(
      Array.from({ length: 4 }, () => http(429)),
      { maxAttempts: 4 },
    );
    await expect(t.query('{ order }')).rejects.toThrow(/did not respond after 4 attempts/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('failures that must not be retried', () => {
  it.each([401, 403, 404, 422])('throws immediately on %i', async (status) => {
    // Retrying a revoked token only revokes it more slowly.
    const { t, fetchImpl } = transport([http(status), ok({})]);
    await expect(t.query('{ order }')).rejects.toThrow(new RegExp(String(status)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a GraphQL error that is not throttling', async () => {
    const { t, fetchImpl } = transport([gql([{ message: 'Field "nope" does not exist' }]), ok({})]);
    await expect(t.query('{ nope }')).rejects.toThrow(/does not exist/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on a 200 with neither data nor errors', async () => {
    // Otherwise this returns undefined and a caller treats absence as "no
    // order found", which is a different and much worse answer.
    const { t } = transport([ok(undefined)]);
    await expect(t.query('{ order }')).rejects.toThrow(/no data/);
  });

  it('never leaks the token in an error message', async () => {
    const { t } = transport([http(401)]);
    await expect(t.query('{ order }')).rejects.toThrow();
    try {
      await transport([http(401)]).t.query('{ order }');
    } catch (error) {
      expect((error as Error).message).not.toContain('FAKE CREDENTIAL');
    }
  });
});

describe('retryable server errors', () => {
  it.each([500, 502, 503, 504])('retries %i and succeeds', async (status) => {
    const { t, fetchImpl } = transport([http(status), ok({ shop: 'x' })]);
    expect(await t.query('{ shop }')).toEqual({ shop: 'x' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially when no Retry-After is given', async () => {
    const { t, slept } = transport([http(503), http(503), ok({})]);
    await t.query('{ shop }');
    expect(slept[1]).toBeGreaterThan(slept[0]!);
  });
});
