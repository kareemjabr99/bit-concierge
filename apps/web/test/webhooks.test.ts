import { createHmac } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createLogger, JOBS, type EnqueueOptions, type JobQueue } from '@bitc/core';
import { handleShopifyWebhook, signatureMatches, type WebhookDeps } from '../src/webhooks.ts';

/**
 * The receiver's one job that has to be right is the signature: a request
 * that fails it is refused before its body is read or believed. Everything
 * after that is answering Shopify in a way that neither loses a delivery
 * (5xx when we failed to keep it) nor invites endless retries of one we do
 * not want (200 when we chose to ignore it).
 */

const SECRET = 'FAKE CREDENTIAL — runtime app client secret';
const TENANT = '00000000-0000-4000-8000-000000000001';
const SHOP = 'bit-concierge-dev.myshopify.com';

const sign = (body: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(body, 'utf8').digest('base64');

const delivery = (
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
): IncomingMessage => {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.headers = {
    'x-shopify-topic': 'products/update',
    'x-shopify-shop-domain': SHOP,
    'x-shopify-webhook-id': 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043',
    'x-shopify-hmac-sha256': sign(body),
    ...headers,
  };
  req.push(body);
  req.push(null);
  return req;
};

const capture = () => {
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  let status = 0;
  let body = '';
  res.writeHead = ((code: number) => {
    status = code;
    return res;
  }) as typeof res.writeHead;
  res.end = ((chunk?: string) => {
    body = chunk ?? '';
    return res;
  }) as typeof res.end;
  return { res, out: () => ({ status, body }) };
};

const setup = (over: Partial<WebhookDeps> = {}) => {
  const queued: { name: string; data: unknown; options: EnqueueOptions }[] = [];
  const queue: JobQueue = {
    enqueue: async (name, data, options = {}) => void queued.push({ name, data, options }),
  };
  const deps: WebhookDeps = {
    secret: SECRET,
    resolveTenant: async (shop) => (shop === SHOP ? TENANT : null),
    queue,
    logger: createLogger({ level: 'error', write: () => {} }),
    ...over,
  };
  const run = async (req: IncomingMessage) => {
    const { res, out } = capture();
    await handleShopifyWebhook(req, res, deps);
    return out();
  };
  return { run, queued };
};

const PRODUCT = JSON.stringify({
  id: 7_000_000_001,
  admin_graphql_api_id: 'gid://shopify/Product/7000000001',
  title: 'Sadu Hoodie',
  body_html: '<p>Customer-visible copy that must not travel in a job.</p>',
  handle: 'sadu-hoodie',
});

describe('signature verification', () => {
  it('accepts the digest Shopify computes over the raw body', () => {
    expect(signatureMatches(Buffer.from(PRODUCT), sign(PRODUCT), SECRET)).toBe(true);
  });

  it.each([
    ['a different secret', sign(PRODUCT, 'FAKE CREDENTIAL — another app')],
    ['a body changed after signing', sign(`${PRODUCT} `)],
    ['no signature', ''],
    ['a truncated signature', sign(PRODUCT).slice(0, 20)],
    [
      'the digest as hex instead of base64',
      createHmac('sha256', SECRET).update(PRODUCT).digest('hex'),
    ],
  ])('refuses %s', (_label, signature) => {
    expect(signatureMatches(Buffer.from(PRODUCT), signature, SECRET)).toBe(false);
  });

  it('refuses everything when no secret is configured, rather than everything passing', () => {
    expect(signatureMatches(Buffer.from(PRODUCT), sign(PRODUCT, ''), '')).toBe(false);
  });
});

describe('the receiver', () => {
  it('queues the product id, and nothing from the payload, for a signed product update', async () => {
    const { run, queued } = setup();
    expect(await run(delivery(PRODUCT))).toEqual({ status: 200, body: 'queued' });
    expect(queued).toEqual([
      {
        name: JOBS.productChanged,
        data: {
          tenantId: TENANT,
          productGid: 'gid://shopify/Product/7000000001',
          topic: 'products/update',
        },
        options: {
          singletonKey: 'webhook:b54557e4-bdd9-4b37-8a5f-bf7d70bcd043',
          singletonSeconds: 14_400,
        },
      },
    ]);
    expect(JSON.stringify(queued)).not.toContain('Customer-visible copy');
  });

  it('builds the id from a delete payload, which carries only the numeric id', async () => {
    const body = JSON.stringify({ id: 7_000_000_001 });
    const { run, queued } = setup();
    await run(delivery(body, { 'x-shopify-topic': 'products/delete' }));
    expect(queued[0]!.data).toMatchObject({ productGid: 'gid://shopify/Product/7000000001' });
  });

  it('refuses an unsigned delivery with 401 and queues nothing', async () => {
    const { run, queued } = setup();
    expect((await run(delivery(PRODUCT, { 'x-shopify-hmac-sha256': '' }))).status).toBe(401);
    expect(queued).toHaveLength(0);
  });

  it('refuses a delivery signed by another app', async () => {
    const { run, queued } = setup();
    const forged = delivery(PRODUCT, {
      'x-shopify-hmac-sha256': sign(PRODUCT, 'FAKE CREDENTIAL — another app'),
    });
    expect((await run(forged)).status).toBe(401);
    expect(queued).toHaveLength(0);
  });

  it('answers 200 and queues nothing for a topic retrieval does not use', async () => {
    const { run, queued } = setup();
    const r = await run(delivery(PRODUCT, { 'x-shopify-topic': 'orders/create' }));
    expect(r).toEqual({ status: 200, body: 'ignored' });
    expect(queued).toHaveLength(0);
  });

  it('answers 200 and queues nothing for a shop with no tenant', async () => {
    const { run, queued } = setup();
    const r = await run(
      delivery(PRODUCT, { 'x-shopify-shop-domain': 'someone-else.myshopify.com' }),
    );
    expect(r).toEqual({ status: 200, body: 'unknown shop' });
    expect(queued).toHaveLength(0);
  });

  it('does not queue an id that is not a product gid', async () => {
    const body = JSON.stringify({ admin_graphql_api_id: 'gid://shopify/Order/1' });
    const { run, queued } = setup();
    expect((await run(delivery(body))).body).toBe('unreadable');
    expect(queued).toHaveLength(0);
  });

  it('answers 503 when the job could not be kept, so Shopify retries', async () => {
    const { run } = setup({
      queue: {
        enqueue: async () => {
          throw new Error('queue down');
        },
      },
    });
    expect((await run(delivery(PRODUCT))).status).toBe(503);
  });

  it('answers 503 rather than rejecting when the tenant lookup fails', async () => {
    const { run, queued } = setup({
      resolveTenant: async () => {
        throw new Error('connection refused');
      },
    });
    expect((await run(delivery(PRODUCT))).status).toBe(503);
    expect(queued).toHaveLength(0);
  });

  it('refuses a body over the limit without verifying or reading it', async () => {
    const big = 'x'.repeat(1_000_001);
    const { run, queued } = setup();
    expect((await run(delivery(big))).status).toBe(413);
    expect(queued).toHaveLength(0);
  });

  it('refuses anything but POST', async () => {
    const { run } = setup();
    expect((await run(delivery(PRODUCT, {}, 'GET'))).status).toBe(405);
  });
});
