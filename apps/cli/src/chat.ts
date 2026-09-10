import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { FixtureKnowledge, loadTenantConfig, runTurn, type TurnResult } from '@bitc/agent';
import { createLogger, readEnv } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { resolveChatModel } from '@bitc/models';
import { MockShopifyClient } from '@bitc/shopify';

/**
 * Phase 1 conversation harness. Real model, synthetic store, fixture
 * knowledge. Shows what the customer would see, and with --debug, what the
 * system did to produce it.
 *
 *   pnpm --filter @bitc/cli chat -- [--tenant pk_dev_1886] [--new] [--debug] [--pace 8]
 */
const args = new Set(process.argv.slice(2));
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const base = readEnv('base');
const models = readEnv('models');
const widgetKey = flag('--tenant', 'pk_dev_1886');
let debug = args.has('--debug');
// Seconds between turns when a transcript is piped in — the free tier allows
// twenty requests a minute and a turn is two or three.
const paceMs = Number(flag('--pace', '0')) * 1000;
let externalId = args.has('--new')
  ? `cli-${Date.now()}`
  : (process.env.BITC_CLI_SESSION ?? `cli-${Date.now()}`);

// Structured logs go to stderr so the transcript on stdout stays readable.
const logger = createLogger({
  level: debug ? 'info' : 'error',
  write: (line) => process.stderr.write(`${line}\n`),
});
const tenantId = await resolveTenantByWidgetKey(widgetKey);
if (!tenantId) {
  console.error(`No active tenant for widget key "${widgetKey}". Run: pnpm db:seed`);
  process.exit(1);
}
const config = await loadTenantConfig(tenantId);
const chat = resolveChatModel(config.chatModel, {
  googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
  ...(models.ANTHROPIC_API_KEY ? { anthropicApiKey: models.ANTHROPIC_API_KEY } : {}),
});
const deps = { chat, shopify: new MockShopifyClient(), knowledge: new FixtureKnowledge(), logger };

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

console.log(
  bold(`${config.brandName} assistant`) +
    dim(`  ·  ${chat.spec.key}  ·  ${base.NODE_ENV}  ·  session ${externalId}`),
);
console.log(dim('commands: /new  /debug  /quit'));
console.log();

const show = (r: TurnResult): void => {
  if (r.reply === null) console.log(dim('(thread is with the team — no automated reply)'));
  else console.log(`${bold('assistant')}  ${r.reply}`);
  if (debug) {
    for (const t of r.recorder.toolCalls) {
      console.log(
        dim(
          `  ↳ ${t.name}(${JSON.stringify(t.input)}) → ${t.ok ? 'ok' : 'error'} ${t.latencyMs}ms`,
        ),
      );
      if (!t.ok)
        console.log(dim(`      ${JSON.stringify((t.output as { error?: unknown }).error)}`));
    }
    if (r.grounding) {
      const g = r.grounding;
      console.log(
        dim(
          `  gate  literal=${g.literal.ok ? 'pass' : 'FAIL ' + JSON.stringify(g.literal.misses)}  citations=${g.citations.ok ? `pass (${g.citations.cited.length} cited)` : 'FAIL ' + JSON.stringify(g.citations.misses)}`,
        ),
      );
    }
    if (r.rawModelText && (r.status !== 'answered' || r.grounding?.citations.cited.length))
      console.log(dim(`  raw   ${r.rawModelText}`));
    console.log(
      dim(
        `  ${r.status}  ·  ${r.steps} steps  ·  ${r.usage.inputTokens}+${r.usage.outputTokens} tokens  ·  ${r.latencyMs}ms  ·  lang ${r.lang}`,
      ),
    );
  }
  console.log();
};

const interactive = Boolean(stdin.isTTY);
const rl = createInterface({ input: stdin, output: stdout, terminal: interactive });
rl.setPrompt(`${bold('you')}   `);
const prompt = (): void => {
  if (interactive) rl.prompt();
};

prompt();
try {
  // The async iterator delivers every line in order and ends at EOF, so the
  // same loop serves a person at a terminal and a transcript piped in.
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) {
      prompt();
      continue;
    }
    if (!interactive) console.log(`${bold('you')}   ${line}`);
    if (line === '/quit') break;
    if (line === '/debug') {
      debug = !debug;
      console.log(dim(`debug ${debug ? 'on' : 'off'}`));
      prompt();
      continue;
    }
    if (line === '/new') {
      externalId = `cli-${Date.now()}`;
      console.log(dim(`new session ${externalId}`));
      prompt();
      continue;
    }
    try {
      show(
        await runTurn(
          { tenantId, channel: 'web', externalConversationId: externalId, text: line },
          deps,
        ),
      );
    } catch (error) {
      console.error('turn failed:', error instanceof Error ? error.message : error);
    }
    if (!interactive && paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    prompt();
  }
} finally {
  rl.close();
  await disconnect();
}
