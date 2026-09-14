import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, beforeEach } from 'vitest';
import { createLogger } from '@bitc/core';
import { handleChat, clientAddress, type ChatApiDeps } from '../src/chat-api.ts';
import { SlidingWindowLimiter } from '../src/rate-limit.ts';
import { deriveSigningKey, externalIdFor, isOurToken, issueToken } from '../src/session.ts';

const TENANT = '00000000-0000-4000-8000-000000000001';
const KEY = deriveSigningKey(Buffer.alloc(32, 7).toString('base64'));

const request = (
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
): IncomingMessage => {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.9' });
  const req = new IncomingMessage(socket);
  req.method = method;
  req.headers = headers;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  req.push(payload);
  req.push(null);
  return req;
};

interface Captured {
  status: number;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}

const capture = (): { res: ServerResponse; out: () => Captured } => {
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  const chunks: string[] = [];
  let status = 0;
  let headers: Record<string, unknown> = {};
  res.writeHead = ((code: number, h?: Record<string, unknown>) => {
    status = code;
    headers = { ...headers, ...(h ?? {}) };
    return res;
  }) as typeof res.writeHead;
  res.setHeader = ((name: string, value: unknown) => {
    headers[name] = value;
    return res;
  }) as typeof res.setHeader;
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    return res;
  }) as typeof res.end;
  return {
    res,
    out: () => ({
      status,
      headers,
      body: chunks.length > 0 ? (JSON.parse(chunks.join('')) as Record<string, unknown>) : {},
    }),
  };
};

const turn = (over: Record<string, unknown> = {}) => ({
  conversationId: 'c1',
  status: 'answered' as const,
  reply: 'Returns are accepted within 7 days.',
  lang: 'en' as const,
  steps: 1,
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 10,
  recorder: { toolCalls: [], retrievalHits: [] },
  grounding: { literal: { misses: [] }, citations: { cited: ['chunk-1'], misses: [] } },
  rawModelText: 'raw model text that must never reach a visitor',
  ...over,
});

let deps: ChatApiDeps;
let calls: { text: string; externalConversationId: string }[];

beforeEach(() => {
  calls = [];
  deps = {
    resolveTenant: async (key) => (key === 'pk_dev_1886' ? TENANT : null),
    runTurn: async (input) => {
      calls.push({ text: input.text, externalConversationId: input.externalConversationId });
      return turn() as never;
    },
    sourcesFor: async () => [{ title: 'Refund policy', url: 'https://example.test/policies' }],
    limiter: new SlidingWindowLimiter(20, 3_600_000),
    logger: createLogger({ level: 'error', write: () => {} }),
    allowedOrigins: async () => ['https://1886riyadh.com'],
    sessionKey: KEY,
  };
});

describe('chat endpoint', () => {
  it('answers a well-formed turn and issues a conversation token', async () => {
    const { res, out } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', text: 'how long do I have to return?' }),
      res,
      deps,
    );
    const { status, body } = out();
    expect(status).toBe(200);
    expect(body.reply).toContain('7 days');
    expect(isOurToken(body.token as string, KEY)).toBe(true);
    expect(body.sources).toEqual([
      { title: 'Refund policy', url: 'https://example.test/policies' },
    ]);
  });

  it('never returns the raw model text, tool calls or chunk ids', async () => {
    // The gate's whole value is that what reaches a customer is the cleared
    // text. Everything else is diagnostics, and some of it is the merchant's
    // business rather than the visitor's.
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'hello' }), res, deps);
    const serialised = JSON.stringify(out().body);
    expect(serialised).not.toContain('raw model text');
    expect(serialised).not.toContain('chunk-1');
    expect(Object.keys(out().body).sort()).toEqual(['lang', 'reply', 'sources', 'status', 'token']);
  });

  it('keeps a conversation when the client returns its token, and separates one when it does not', async () => {
    const { res: r1, out: o1 } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'first' }), r1, deps);
    const token = o1().body.token as string;

    const { res: r2 } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', token, text: 'second' }), r2, deps);
    const { res: r3 } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'someone else' }), r3, deps);

    expect(calls[0]!.externalConversationId).toBe(calls[1]!.externalConversationId);
    expect(calls[2]!.externalConversationId).not.toBe(calls[0]!.externalConversationId);
  });

  it('does not store the token itself as the conversation id', async () => {
    // A database dump should not hand over live sessions.
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'hello' }), res, deps);
    const token = out().body.token as string;
    expect(calls[0]!.externalConversationId).not.toContain(token);
    expect(calls[0]!.externalConversationId).toBe(externalIdFor(token));
  });

  it('refuses to adopt a conversation token it did not issue', async () => {
    // The threat the signature exists for. An unsigned random token looks
    // safe and is not: the client sends it back, so the client can send back
    // anything. Two visitors who both post a chosen token would otherwise
    // share a conversation, and a transcript here holds order numbers and
    // email addresses.
    const chosen = 'AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB';
    const { res: r1, out: o1 } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', token: chosen, text: 'visitor one' }),
      r1,
      deps,
    );
    const { res: r2, out: o2 } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', token: chosen, text: 'visitor two' }),
      r2,
      deps,
    );

    expect(o1().body.token).not.toBe(chosen);
    expect(o2().body.token).not.toBe(chosen);
    expect(calls[0]!.externalConversationId).not.toBe(calls[1]!.externalConversationId);
  });

  it('rejects a token signed with a different key', async () => {
    const foreign = issueToken(deriveSigningKey(Buffer.alloc(32, 9).toString('base64')));
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', token: foreign, text: 'hi' }), res, deps);
    expect(out().body.token).not.toBe(foreign);
  });

  it('treats a malformed token as a new conversation rather than an error', async () => {
    const { res, out } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', token: '../../etc/passwd', text: 'hi' }),
      res,
      deps,
    );
    expect(out().status).toBe(200);
    expect(calls[0]!.externalConversationId).toMatch(/^web:[0-9a-f]{32}$/);
  });

  it('refuses an unknown widget key without saying why', async () => {
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_not_a_tenant', text: 'hi' }), res, deps);
    expect(out().status).toBe(404);
    expect(out().body).toEqual({ error: 'unknown_widget' });
  });

  it('refuses an origin the tenant has not registered', async () => {
    const { res, out } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', text: 'hi' }, { origin: 'https://evil.test' }),
      res,
      deps,
    );
    expect(out().status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('echoes only a registered origin back, and varies on it', async () => {
    const { res, out } = capture();
    await handleChat(
      request({ widgetKey: 'pk_dev_1886', text: 'hi' }, { origin: 'https://1886riyadh.com' }),
      res,
      deps,
    );
    expect(out().headers['access-control-allow-origin']).toBe('https://1886riyadh.com');
    expect(out().headers['vary']).toBe('origin');
  });

  it('rate limits per visitor and says when to come back', async () => {
    deps.limiter = new SlidingWindowLimiter(2, 3_600_000);
    for (let i = 0; i < 2; i += 1) {
      const { res } = capture();
      await handleChat(request({ widgetKey: 'pk_dev_1886', text: `turn ${i}` }), res, deps);
    }
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'one too many' }), res, deps);
    expect(out().status).toBe(429);
    expect(Number(out().headers['retry-after'])).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it('refuses an oversized body before parsing it', async () => {
    // Deliberately valid-looking and enormous: a payload that would pass the
    // schema if it ever reached it, so what rejects it is the byte limit
    // rather than zod. An unauthenticated endpoint should not let a stranger
    // choose how much memory it uses.
    const padding = 'a'.repeat(64_000);
    const body = JSON.stringify({ widgetKey: 'pk_dev_1886', text: 'hi', padding });
    expect(body.length).toBeGreaterThan(16_384);
    const { res, out } = capture();
    await handleChat(request(body), res, deps);
    expect(out().status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects a turn with no text, and one that is only whitespace-free padding', async () => {
    for (const text of ['', 'y'.repeat(2001)]) {
      const { res, out } = capture();
      await handleChat(request({ widgetKey: 'pk_dev_1886', text }), res, deps);
      expect(out().status).toBe(400);
    }
  });

  it('rejects anything that is not a POST', async () => {
    const { res, out } = capture();
    await handleChat(request({}, {}, 'GET'), res, deps);
    expect(out().status).toBe(405);
  });

  it('returns a generic error when the turn throws, and logs the detail', async () => {
    const lines: string[] = [];
    deps.logger = createLogger({ level: 'error', write: (l) => lines.push(l) });
    deps.runTurn = async () => {
      throw new Error('postgres is on fire');
    };
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'hi' }), res, deps);
    expect(out().status).toBe(500);
    expect(JSON.stringify(out().body)).not.toContain('postgres');
    expect(lines.join(' ')).toContain('postgres is on fire');
  });

  it('passes the escalation copy through when the gate withheld the reply', async () => {
    deps.runTurn = async () =>
      turn({ status: 'suppressed', reply: 'I have asked the team.', grounding: null }) as never;
    const { res, out } = capture();
    await handleChat(request({ widgetKey: 'pk_dev_1886', text: 'hi' }), res, deps);
    expect(out().body.status).toBe('suppressed');
    expect(out().body.reply).toBe('I have asked the team.');
    expect(out().body.sources).toEqual([
      { title: 'Refund policy', url: 'https://example.test/policies' },
    ]);
  });
});

describe('client address', () => {
  it('takes the last forwarded hop, not the first', () => {
    // The first entry is whatever the client claimed; the last is what the
    // proxy observed. Backwards, and the rate limit becomes a header a visitor
    // can set.
    const req = request({}, { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 198.51.100.7' });
    expect(clientAddress(req, true)).toBe('198.51.100.7');
  });

  it('ignores the header entirely when nothing in front is trusted', () => {
    const req = request({}, { 'x-forwarded-for': '1.1.1.1' });
    expect(clientAddress(req, false)).toBe('203.0.113.9');
  });
});

describe('session tokens', () => {
  it('issues unguessable tokens', () => {
    const seen = new Set(Array.from({ length: 500 }, () => issueToken(KEY)));
    expect(seen.size).toBe(500);
    for (const token of seen) expect(isOurToken(token, KEY)).toBe(true);
  });

  it('rejects anything it did not sign', () => {
    const valid = issueToken(KEY);
    const [nonce, tag] = valid.split('.') as [string, string];
    const cases = [
      '',
      'short',
      '../../etc',
      valid.replace('.', ''),
      `${nonce}.${'A'.repeat(tag.length)}`,
      `${'A'.repeat(nonce.length)}.${tag}`,
      `${nonce}.${tag}extra`,
      issueToken(deriveSigningKey(Buffer.alloc(32, 9).toString('base64'))),
    ];
    for (const bad of cases) {
      expect(isOurToken(bad, KEY), `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('derives a signing key that is not the encryption key', () => {
    // Session tokens and encrypted Shopify credentials must never share key
    // material, so that compromising one does not hand over the other.
    const encryption = Buffer.alloc(32, 7);
    expect(deriveSigningKey(encryption.toString('base64')).equals(encryption)).toBe(false);
  });

  it('derives the same key from the same input, and a different one otherwise', () => {
    const a = deriveSigningKey(Buffer.alloc(32, 7).toString('base64'));
    const b = deriveSigningKey(Buffer.alloc(32, 7).toString('base64'));
    const c = deriveSigningKey(Buffer.alloc(32, 8).toString('base64'));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('does not store the token itself', () => {
    const token = issueToken(KEY);
    expect(externalIdFor(token)).not.toContain(token);
    expect(externalIdFor(token)).toMatch(/^web:[0-9a-f]{32}$/);
  });
});
