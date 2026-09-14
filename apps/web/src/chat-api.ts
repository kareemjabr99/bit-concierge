import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { asTenantId, type Logger } from '@bitc/core';
import type { TurnInput, TurnResult } from '@bitc/agent';
import { externalIdFor, isOurToken, issueToken } from './session.ts';
import type { SlidingWindowLimiter } from './rate-limit.ts';

/**
 * The storefront chat endpoint.
 *
 * One POST, one turn, one complete reply. **There is no token streaming, and
 * that is not an omission.** The deterministic grounding gate runs on the
 * finished text — the literal check needs every literal, and the citation
 * check needs every sentence — and its verdict can be "withhold this reply and
 * fetch a human". A stream cannot be un-sent. Streaming the answer would mean
 * either showing text the gate has not cleared, or clearing it sentence by
 * sentence, which the concept check cannot do because a sentence's citation may
 * be established by a later one.
 *
 * So the latency is visible: 3.2s at the median and 8.1s at p95. The widget
 * spends it on progress rather than hiding it, and that is a UX problem rather
 * than an architectural one. Trading the guarantee for a nicer wait would be
 * trading away the only thing here worth selling.
 */

const chatRequest = z.object({
  /** Public, printed in the storefront's HTML. Identifies a tenant; authorises nothing. */
  widgetKey: z.string().min(6).max(120),
  /** Issued by this endpoint on the first turn. Absent starts a conversation. */
  token: z.string().optional(),
  text: z.string().min(1).max(2000),
  /** Advisory. The agent detects language from the text regardless. */
  locale: z.enum(['en', 'ar']).optional(),
});

export type ChatRequest = z.infer<typeof chatRequest>;

export interface ChatResponse {
  token: string;
  status: TurnResult['status'];
  reply: string;
  lang: string;
  /** Resolved citations, for rendering as links. Never raw chunk ids. */
  sources: { title: string; url: string | null }[];
}

export interface ChatApiDeps {
  /** Widget key → tenant id. Returns null for an unknown or suspended tenant. */
  resolveTenant: (widgetKey: string) => Promise<string | null>;
  runTurn: (input: TurnInput) => Promise<TurnResult>;
  /** Resolves cited chunk ids to something a customer can click. */
  sourcesFor: (tenantId: string, chunkIds: string[]) => Promise<ChatResponse['sources']>;
  limiter: SlidingWindowLimiter;
  logger: Logger;
  /** Origins allowed to call this, per tenant. Empty allows none. */
  allowedOrigins: (tenantId: string) => Promise<string[]>;
  /** Derived from ENCRYPTION_KEY. Signs conversation tokens. */
  sessionKey: Buffer;
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // Nothing here is cacheable and some of it is a customer's own words.
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
};

const readBody = async (req: IncomingMessage, limitBytes = 16_384): Promise<string> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Refuse rather than buffer. An unauthenticated endpoint should not let a
    // stranger choose how much memory it uses.
    if (size > limitBytes) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * The visitor's address, for rate limiting.
 *
 * `x-forwarded-for` is client-controlled unless something in front of us
 * rewrites it. Fly does. Taking the LAST entry rather than the first is
 * deliberate: the first is whatever the client claimed, the last is what the
 * proxy observed. Getting this backwards turns the rate limit into a header a
 * visitor can set.
 */
export const clientAddress = (req: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const chain = Array.isArray(header) ? header.join(',') : (header ?? '');
    const hops = chain
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return req.socket.remoteAddress ?? 'unknown';
};

export const handleChat = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: ChatApiDeps,
  options: { trustProxy?: boolean } = {},
): Promise<void> => {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
    return;
  }

  let parsed: ChatRequest;
  try {
    parsed = chatRequest.parse(JSON.parse(await readBody(req)));
  } catch {
    // Deliberately uninformative. A validation message that echoes the input
    // is a reflection primitive, and there is no developer on the other end of
    // this endpoint — only a storefront visitor.
    json(res, 400, { error: 'bad_request' });
    return;
  }

  const tenantId = await deps.resolveTenant(parsed.widgetKey);
  if (!tenantId) {
    json(res, 404, { error: 'unknown_widget' });
    return;
  }

  // Origin is checked after the tenant resolves, because the allowed list is
  // the tenant's. An absent Origin is a non-browser caller: allowed, because
  // the endpoint is public anyway and rate limiting is the real control.
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const allowed = await deps.allowedOrigins(tenantId);
    if (!allowed.includes(origin)) {
      deps.logger.warn('chat request from an origin this tenant has not registered', {
        tenantId,
        origin,
      });
      json(res, 403, { error: 'origin_not_allowed' });
      return;
    }
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }

  const limit = deps.limiter.check(
    `${tenantId}:${clientAddress(req, options.trustProxy ?? false)}`,
  );
  if (!limit.allowed) {
    json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(limit.retryAfter) });
    return;
  }

  // A token we did not issue starts a fresh conversation rather than erroring:
  // the visitor gets a working widget instead of a wall, and a forged token
  // has nothing to be told about. Verifying the signature — not the shape — is
  // what stops one visitor naming another's conversation.
  const token =
    parsed.token && isOurToken(parsed.token, deps.sessionKey)
      ? parsed.token
      : issueToken(deps.sessionKey);

  try {
    const turn = await deps.runTurn({
      tenantId: asTenantId(tenantId),
      channel: 'web',
      externalConversationId: externalIdFor(token),
      text: parsed.text,
      ...(parsed.locale ? { localeHint: parsed.locale } : {}),
    });

    // Only what the gate cleared. rawModelText, tool calls, retrieval scores
    // and chunk ids stay on this side of the wire — they are diagnostics, and
    // some of them are the merchant's business rather than the visitor's.
    json(res, 200, {
      token,
      status: turn.status,
      reply: turn.reply ?? '',
      lang: turn.lang,
      sources: await deps.sourcesFor(tenantId, turn.grounding?.citations.cited ?? []),
    } satisfies ChatResponse);
  } catch (error) {
    deps.logger.error('chat turn failed', { tenantId, err: String(error) });
    json(res, 500, { error: 'turn_failed' });
  }
};
