import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asTenantId, createLogger, readEnv } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import { cachedEmbedder, resolveChatModel, resolveEmbedder, resolveReranker } from '@bitc/models';
import { PgGapRecorder, PgKnowledgeSearcher } from '@bitc/rag';
import { MockShopifyClient } from '@bitc/shopify';
import {
  diffRuns,
  readBaseline,
  writeBaseline,
  needsReview,
  suppressionsToReview,
} from './baseline.ts';
import { reportDiff, reportRun } from './report.ts';
import { persistRun, runSuite } from './runner.ts';
import { suiteFile, type EvalCase } from './types.ts';

/**
 *   pnpm evals run   [--suite en-core] [--model KEY] [--baseline] [--out report.md]
 *   pnpm evals diff  [--suite en-core] --model KEY
 *
 * `run` executes the suite and prints a report. `--baseline` records the run as
 * the baseline for its model. `diff` runs the suite on a second model and
 * compares it to the recorded baseline, case by case.
 *
 * Orders come from the mock store; knowledge comes from the real index. Query
 * embeddings are cached, so a repeat run costs no provider quota and a diff
 * measures the model rather than the embedding endpoint's variance.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, '..', 'cases');
const BASELINE_DIR = join(HERE, '..', 'baselines');

const arg = (name: string, fallback = ''): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const command = process.argv[2] ?? 'run';
const suiteName = arg('suite', 'en-core');

const loadCases = (suite: string): EvalCase[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith('.json')) files.push(join(dir, entry.name));
    }
  };
  walk(CASES_DIR);

  const cases: EvalCase[] = [];
  for (const file of files) {
    const parsed = suiteFile.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (parsed.suite !== suite) continue;
    cases.push(...parsed.cases);
  }
  if (cases.length === 0) throw new Error(`No cases found for suite "${suite}" under ${CASES_DIR}`);
  return cases;
};

const build = async () => {
  const models = readEnv('models');
  const tenantId = await resolveTenantByWidgetKey(arg('tenant', 'pk_dev_1886'));
  if (!tenantId) throw new Error('No dev tenant. Run: pnpm db:seed');
  const config = await loadTenantConfig(asTenantId(tenantId));

  const chatKey = arg('model', config.chatModel);
  const chat = resolveChatModel(chatKey, {
    googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
    ...(models.ANTHROPIC_API_KEY ? { anthropicApiKey: models.ANTHROPIC_API_KEY } : {}),
  });
  const embedder = cachedEmbedder(
    resolveEmbedder(config.embeddingModel, { googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY }),
    { dir: process.env.BITC_EMBED_CACHE ?? join(HERE, '..', '..', '..', '.embed-cache') },
  );
  const reranker = resolveReranker(arg('reranker', config.reranker), { model: chat.model });

  return {
    tenantId: asTenantId(tenantId),
    config,
    embedder,
    deps: {
      chat,
      shopify: new MockShopifyClient(),
      knowledge: new PgKnowledgeSearcher(asTenantId(tenantId), embedder, reranker),
      gaps: new PgGapRecorder(asTenantId(tenantId)),
      logger: createLogger({ level: 'error', write: (line) => process.stderr.write(`${line}\n`) }),
    },
  };
};

const execute = async () => {
  const { tenantId, config, embedder, deps } = await build();
  const cases = loadCases(suiteName);
  process.stderr.write(
    `${cases.length} cases · ${deps.chat.spec.key} · pacing ${deps.chat.spec.quota?.requestsPerMinute ?? '∞'}/min\n`,
  );

  const result = await runSuite({
    tenantId,
    suite: suiteName,
    deps,
    cases,
    productionChatModel: config.productionChatModel,
    onCase: (outcome, index, total) =>
      process.stderr.write(
        `  [${String(index + 1).padStart(3)}/${total}] ${outcome.passed ? 'pass' : 'FAIL'}  ${outcome.id}${outcome.passed ? '' : ` — ${outcome.failures[0]}`}\n`,
      ),
  });
  result.embeddingModel = config.embeddingModel;
  result.reranker = config.reranker;
  process.stderr.write(
    `embedding cache: ${embedder.stats.hits} hits, ${embedder.stats.misses} misses\n`,
  );
  return { tenantId, result };
};

try {
  if (command === 'run') {
    const { tenantId, result } = await execute();
    const markdown = reportRun(result);
    console.log(markdown);
    const out = arg('out');
    if (out) writeFileSync(out, `${markdown}\n`);
    await persistRun(tenantId, result);
    if (has('baseline')) {
      const path = writeBaseline(BASELINE_DIR, result);
      process.stderr.write(`baseline written: ${path}\n`);
    }
    process.exitCode = result.metrics.hallucinationCount > 0 ? 1 : 0;
  } else if (command === 'diff') {
    const { result } = await execute();
    const against = arg('against');
    const baseline = readBaseline(BASELINE_DIR, suiteName, against || '');
    if (!baseline) {
      console.error(
        `No baseline for suite "${suiteName}" model "${against}". Record one first:\n` +
          `  pnpm evals run --suite ${suiteName} --model ${against} --baseline`,
      );
      process.exitCode = 1;
    } else {
      const diff = diffRuns(baseline, result);
      console.log(reportDiff(diff));
      const review = needsReview(diff);
      const suppressed = suppressionsToReview(diff, result.outcomes);
      if (review.length > 0 || suppressed.length > 0) {
        console.log('');
        console.log(
          `> **${review.length} case(s) and ${suppressed.length} new suppression(s) need reading before this swap is accepted.**`,
        );
      }
      process.exitCode = review.length > 0 || diff.hallucinationDelta > 0 ? 1 : 0;
    }
  } else {
    console.error(
      'Usage: evals run|diff [--suite S] [--model KEY] [--against KEY] [--baseline] [--out FILE]',
    );
    process.exitCode = 1;
  }
} finally {
  await disconnect();
}
