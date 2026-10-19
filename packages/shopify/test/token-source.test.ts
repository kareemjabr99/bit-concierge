import { describe, expect, it, vi } from 'vitest';
import { AccessTokenCache, AdminTransport, type RequestAccessToken } from '../src/index.ts';

/**
 * Token renewal for a process that stays up longer than a token lasts.
 *
 * Before this existed the factory minted one 24-hour token and handed the
 * transport a fixed string, which is correct for a CLI session and, in a
 * server, turns every order question on day two into a hand-over. The clock is
 * injected throughout; nothing here waits.
 */

const T0 = Date.parse('2026-10-18T09:00:00Z');
const HOUR = 3600_000;

const minter = () => {
  let n = 0;
  const request = vi.fn<RequestAccessToken>(async () => {
    n += 1;
    return {
      ok: true,
      grant: {
        accessToken: `FAKE CREDENTIAL — token ${n}`,
        scope: 'read_orders',
        expiresInSeconds: 86_400,
      },
    };
  });
  return request;
};

describe('the token cache', () => {
  it('reuses a token until it is inside the renewal margin, then mints', async () => {
    let clock = T0;
    const request = minter();
    const cache = new AccessTokenCache(() => clock, 5 * 60_000, request);
    const source = cache.source('s.example', 'id', 'secret');

    expect(await source.token()).toBe('FAKE CREDENTIAL — token 1');
    clock = T0 + 24 * HOUR - 6 * 60_000; // six minutes left: still fresh
    expect(await source.token()).toBe('FAKE CREDENTIAL — token 1');
    clock = T0 + 24 * HOUR - 4 * 60_000; // four minutes left: renew
    expect(await source.token()).toBe('FAKE CREDENTIAL — token 2');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shares one grant between lookups that arrive together at expiry', async () => {
    const request = minter();
    const cache = new AccessTokenCache(() => T0, undefined, request);
    const source = cache.source('s.example', 'id', 'secret');
    const tokens = await Promise.all([source.token(), source.token(), source.token()]);
    expect(new Set(tokens)).toEqual(new Set(['FAKE CREDENTIAL — token 1']));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('mints again after a failed grant rather than caching the failure', async () => {
    const request = vi
      .fn<RequestAccessToken>()
      .mockResolvedValueOnce({ ok: false, error: 'invalid_client' })
      .mockImplementation(minter());
    const source = new AccessTokenCache(() => T0, undefined, request).source('s', 'id', 'x');
    await expect(source.token()).rejects.toThrow(/invalid_client/);
    expect(await source.token()).toBe('FAKE CREDENTIAL — token 1');
  });

  it('discards a token when told the store rejected it', async () => {
    const request = minter();
    const source = new AccessTokenCache(() => T0, undefined, request).source('s', 'id', 'x');
    await source.token();
    source.invalidate();
    expect(await source.token()).toBe('FAKE CREDENTIAL — token 2');
  });

  it('keeps one app on one store apart from another', async () => {
    const request = minter();
    const cache = new AccessTokenCache(() => T0, undefined, request);
    await cache.source('a.example', 'id', 'x').token();
    await cache.source('b.example', 'id', 'x').token();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('a transport holding a source', () => {
  const response = (status: number): Response =>
    ({
      ok: status === 200,
      status,
      headers: new Headers(),
      json: async () => ({ data: { shop: { name: 'x' } } }),
    }) as Response;

  const over = (statuses: number[], tokens: { token(): Promise<string>; invalidate(): void }) => {
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
      sent.push(init.headers['x-shopify-access-token']!);
      return response(statuses.shift() ?? 200);
    }) as unknown as typeof fetch;
    const t = new AdminTransport({
      shop: 's.example',
      accessToken: tokens,
      apiVersion: '2026-07',
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    });
    return { t, sent };
  };

  it('does not spend a throttle attempt on the renewal', async () => {
    // maxAttempts is 2: a 401 renewed, then a 503, then success. If the
    // renewal counted as an attempt, the 503 would be the last one.
    const source = new AccessTokenCache(() => T0, undefined, minter()).source('s', 'id', 'x');
    const { t, sent } = over([401, 503, 200], source);
    await expect(t.query('{ shop { name } }')).resolves.toEqual({ shop: { name: 'x' } });
    expect(sent).toHaveLength(3);
  });

  it('refuses a seeding credential that a source hands it, by value', async () => {
    const previous = process.env.SHOPIFY_SEED_TOKEN;
    process.env.SHOPIFY_SEED_TOKEN = 'FAKE CREDENTIAL — seed token';
    try {
      const { t, sent } = over([], {
        token: async () => 'FAKE CREDENTIAL — seed token',
        invalidate: () => {},
      });
      await expect(t.query('{ shop { name } }')).rejects.toThrow(/seeding credential/);
      expect(sent).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SHOPIFY_SEED_TOKEN;
      else process.env.SHOPIFY_SEED_TOKEN = previous;
    }
  });
});
