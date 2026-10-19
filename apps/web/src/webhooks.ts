import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JOBS, type JobQueue, type Logger } from '@bitc/core';

/**
 * Shopify webhooks: verify, enqueue, answer. Nothing else happens in the
 * request.
 *
 * Checked against Shopify's docs on 2026-10-19
 * (https://shopify.dev/docs/apps/build/webhooks/verify-deliveries):
 *
 * - `X-Shopify-Hmac-SHA256` is the base64 HMAC-SHA256 of the **raw** body,
 *   keyed with the app's client secret. Verified before the body is parsed or
 *   believed; a payload that fails is answered 401 and never read.
 * - Shopify waits five seconds for a 2xx, then retries eight times over four
 *   hours, then (for an Admin API subscription) deletes the subscription. So
 *   the work is a queued job, and the answer is 200 as soon as it is queued.
 * - The same delivery can arrive twice. `X-Shopify-Webhook-Id` keys the job
 *   as a throttled singleton, so a duplicate inside the window enqueues
 *   nothing.
 *
 * What is enqueued is the product's id, never its copy: a job carries ids
 * only (packages/core/src/jobs.ts). Whoever consumes the job reads the product
 * from the store; the payload Shopify sent is discarded here.
 *
 * **Nothing consumes `product-changed` yet.** Re-indexing a product spends
 * embedding quota on every edit a merchant makes, which on the free-tier key
 * collides with the one-model-use-per-day rule; that is the owner's call
 * (docs/phase-4-plan.md). Until then the jobs wait and expire after pg-boss's
 * retention. The receiver is built so that subscribing a store later does not
 * also mean writing the part that has to be right about signatures.
 */

/** Product topics are the ones retrieval cares about. Others are answered and ignored. */
export const PRODUCT_TOPICS = new Set(['products/create', 'products/update', 'products/delete']);

/** A product payload is a few kilobytes; a large catalogue entry, tens. */
const MAX_BODY_BYTES = 1_000_000;

export interface WebhookDeps {
  /** The client secret of the app the subscription belongs to. */
  secret: string;
  resolveTenant: (shop: string) => Promise<string | null>;
  queue: JobQueue;
  logger: Logger;
}

const header = (req: IncomingMessage, name: string): string => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

const readRaw = async (req: IncomingMessage): Promise<Buffer | null> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};

/** Constant-time over the decoded digests. A length mismatch is a mismatch. */
export const signatureMatches = (raw: Buffer, signature: string, secret: string): boolean => {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const answer = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain' }).end(body);
};

export const handleShopifyWebhook = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookDeps,
): Promise<void> => {
  if (req.method !== 'POST') return answer(res, 405, 'method not allowed');

  const raw = await readRaw(req);
  if (raw === null) return answer(res, 413, 'too large');

  if (!signatureMatches(raw, header(req, 'x-shopify-hmac-sha256'), deps.secret)) {
    // Logged without the body or the signature: an unsigned request is a
    // stranger's text, and there is nothing in it worth keeping.
    deps.logger.warn('webhook_signature_rejected', { shop: header(req, 'x-shopify-shop-domain') });
    return answer(res, 401, 'invalid signature');
  }

  const topic = header(req, 'x-shopify-topic');
  const shop = header(req, 'x-shopify-shop-domain');
  const deliveryId = header(req, 'x-shopify-webhook-id');
  const log = deps.logger.child({ topic, shop });

  if (!PRODUCT_TOPICS.has(topic)) {
    // 200, not 4xx: an error would make Shopify retry a delivery we will
    // never want, and eventually delete the subscription.
    log.info('webhook_ignored');
    return answer(res, 200, 'ignored');
  }

  const tenantId = await deps.resolveTenant(shop);
  if (!tenantId) {
    // Signed by our app, for a store with no active tenant: uninstalled, or
    // not onboarded. Acknowledged so Shopify stops; logged so someone looks.
    log.warn('webhook_unknown_shop');
    return answer(res, 200, 'unknown shop');
  }

  let productGid: unknown;
  try {
    const body = JSON.parse(raw.toString('utf8')) as {
      admin_graphql_api_id?: unknown;
      id?: unknown;
    };
    productGid =
      body.admin_graphql_api_id ??
      (typeof body.id === 'number' || typeof body.id === 'string'
        ? `gid://shopify/Product/${body.id}`
        : undefined);
  } catch {
    productGid = undefined;
  }
  if (typeof productGid !== 'string' || !/^gid:\/\/shopify\/Product\/\d+$/.test(productGid)) {
    log.warn('webhook_unreadable_product');
    return answer(res, 200, 'unreadable');
  }

  try {
    await deps.queue.enqueue(
      JOBS.productChanged,
      { tenantId, productGid, topic },
      // Throttled per delivery id over Shopify's four-hour retry window. pg-boss
      // windows are clock-aligned, so a retry that crosses a boundary can
      // queue twice; consumers must be idempotent regardless, as Shopify's
      // own docs require.
      deliveryId ? { singletonKey: `webhook:${deliveryId}`, singletonSeconds: 4 * 3600 } : {},
    );
  } catch (error) {
    // 5xx so Shopify retries: the delivery was valid and we failed to keep it.
    log.error('webhook_enqueue_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return answer(res, 503, 'try again');
  }
  log.info('webhook_queued', { productGid });
  return answer(res, 200, 'queued');
};
