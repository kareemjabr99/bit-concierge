import { createServer } from 'node:http';
import { asTenantId, createLogger, readEnv } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig, runTurn } from '@bitc/agent';
import { resolveChatModel, resolveEmbedder, resolveReranker } from '@bitc/models';
import { citationSources, PgGapRecorder, PgKnowledgeSearcher } from '@bitc/rag';
import { MockShopifyClient } from '@bitc/shopify';
import { handleChat } from './chat-api.ts';
import { deriveSigningKey } from './session.ts';
import { SlidingWindowLimiter } from './rate-limit.ts';

/**
 * The storefront chat server.
 *
 * node:http rather than a framework. One POST endpoint and one static bundle
 * do not need routing, and the supply-chain policy makes every dependency a
 * thing to justify: a framework here would be several hundred transitive
 * packages to hold a request shape this file already describes in thirty
 * lines.
 *
 * Phase 4 replaces this with the Shopify embedded admin, which does need a
 * framework. The handler is separate from the server for exactly that reason.
 */

const env = readEnv('encryption');
const models = readEnv('models');
const port = Number(process.env.PORT ?? 8787);
const trustProxy = process.env.TRUST_PROXY === 'true';
const logger = createLogger({ level: 'info' });

const sessionKey = deriveSigningKey(env.ENCRYPTION_KEY);
// Per visitor, per hour. The tenant's own lookupLimits govern tool use inside
// a conversation; this governs how many turns a stranger can start at all.
const limiter = new SlidingWindowLimiter(30, 3_600_000);
setInterval(() => limiter.sweep(), 600_000).unref();

const chatModelFor = async (tenantId: string) => {
  const config = await loadTenantConfig(asTenantId(tenantId));
  const chat = resolveChatModel(config.chatModel, {
    googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
    ...(models.ANTHROPIC_API_KEY ? { anthropicApiKey: models.ANTHROPIC_API_KEY } : {}),
  });
  const embedder = resolveEmbedder(config.embeddingModel, {
    googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return { config, chat, embedder };
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }

  if (url.pathname !== '/api/chat') {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
    return;
  }

  // Preflight. Answered before the tenant is known, because a browser will not
  // send the body until this succeeds; the real origin check happens on the
  // POST, where the tenant's allowed list is available.
  if (req.method === 'OPTIONS') {
    res
      .writeHead(204, {
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'origin',
      })
      .end();
    return;
  }

  void handleChat(
    req,
    res,
    {
      resolveTenant: async (widgetKey) => (await resolveTenantByWidgetKey(widgetKey)) ?? null,
      runTurn: async (input) => {
        const { config, chat, embedder } = await chatModelFor(input.tenantId);
        return runTurn(input, {
          chat,
          shopify: new MockShopifyClient(),
          knowledge: new PgKnowledgeSearcher(
            input.tenantId,
            embedder,
            resolveReranker(config.reranker, { model: chat.model }),
          ),
          gaps: new PgGapRecorder(input.tenantId),
          logger,
        });
      },
      sourcesFor: (tenantId, chunkIds) => citationSources(asTenantId(tenantId), chunkIds),
      allowedOrigins: async (tenantId) =>
        (await loadTenantConfig(asTenantId(tenantId))).widgetOrigins,
      limiter,
      logger,
      sessionKey,
    },
    { trustProxy },
  );
});

server.listen(port, () => logger.info('storefront chat listening', { port, trustProxy }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void disconnect().then(() => process.exit(0)));
  });
}
