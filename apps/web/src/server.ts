import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
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
const isProduction = process.env.NODE_ENV === 'production';
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

/**
 * A bare page that embeds the widget, for looking at it.
 *
 * Deliberately almost empty: the widget has to survive a merchant's theme, and
 * a demo page with its own styling would hide exactly the bleed-through this
 * is meant to expose. The paragraph of aggressive CSS is there on purpose — if
 * the shadow boundary ever stops working, this page shows it immediately.
 *
 * The script tag carries a timestamp because a browser that has cached the
 * bundle will happily keep serving it after a rebuild, and ten minutes went
 * into chasing a fix that had already been applied.
 */
const demoPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>1886 — widget harness</title>
<style>
  /* Hostile on purpose. A merchant theme that styles every element is normal. */
  * { font-family: 'Comic Sans MS', cursive; color: #b00; }
  div, button, input { border: 3px dotted #b00 !important; background: #ffe !important; }
  body { margin: 0; padding: 48px; background: #fffdf5; }
</style>
</head>
<body>
  <h1>Widget harness</h1>
  <p>This page styles every element badly on purpose. If any of it reaches
     inside the widget, the shadow boundary is not doing its job.</p>
  <p>Try: <em>how long do I have to return something?</em> · <em>do you deliver to Kuwait?</em></p>
  <script src="/widget.js?v=${Date.now()}" data-bitc-key="pk_dev_1886" data-bitc-endpoint="/api/chat" defer></script>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // The built embed, and a page that embeds it. Served from here in Phase 3
  // because there is one process and no CDN yet; Phase 4 moves the bundle to
  // one and this route goes away.
  if (url.pathname === '/widget.js') {
    try {
      const bundle = readFileSync(
        fileURLToPath(new URL('../../widget/dist/widget.js', import.meta.url)),
      );
      res
        .writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          // Any storefront may load the script itself; what it may then DO is
          // governed by the tenant's widget_origins on /api/chat.
          'access-control-allow-origin': '*',
          // Five minutes in production is right for a file every storefront
          // page loads. In development it means a rebuilt bundle silently does
          // not reach the browser, which cost a confusing ten minutes chasing
          // a fix that was already applied.
          'cache-control': isProduction ? 'public, max-age=300' : 'no-store',
        })
        .end(bundle);
    } catch {
      res
        .writeHead(404, { 'content-type': 'text/plain' })
        .end('run: pnpm --filter @bitc/widget build');
    }
    return;
  }

  if (url.pathname === '/demo') {
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(demoPage());
    return;
  }

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
      runTurn: async (input, onStage) => {
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
          onStage,
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
