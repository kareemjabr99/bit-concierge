import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asTenantId, createLogger, readEnv } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey } from '@bitc/db';
import { loadTenantConfig } from '@bitc/agent';
import type { AdmissionPolicy } from '@bitc/models';
import {
  cachedEmbedder,
  cachedReranker,
  recordingReranker,
  resolveChatModel,
  resolveEmbedder,
  resolveReranker,
} from '@bitc/models';
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
import { loadAdjudications } from './adjudication.ts';

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
  // Cached like the embedder, and for a sharper reason: a model-backed reranker
  // costs one chat request per search, and chat requests are the binding
  // free-tier limit — 500 a day. See @bitc/models rerank-cache.ts.
  const cached = cachedReranker(
    resolveReranker(arg('reranker', config.reranker), { model: chat.model }),
    { dir: process.env.BITC_RERANK_CACHE ?? join(HERE, '..', '..', '..', '.rerank-cache') },
  );
  // Recording wraps the cache, so a cached verdict is captured too. The shape
  // of this distribution is what decided whether the threshold was a
  // calibrated threshold or a coin toss wearing a number.
  // --admits relevant | relevant_or_partial. Rejected rather than coerced: a
  // typo silently running the default arm would make the comparison a lie.
  const admitsArg = (): AdmissionPolicy => {
    const value = arg('admits');
    if (value !== 'relevant' && value !== 'relevant_or_partial') {
      throw new Error(`--admits must be "relevant" or "relevant_or_partial", got "${value}"`);
    }
    return value;
  };

  const rerankLog = process.env.BITC_RERANK_LOG;
  // Advanced by the runner's onCaseStart, so every recorded score names the
  // case that produced it. Correlating by file order instead would work right
  // up until a retry or a cache hit shifted one of them by a line.
  const currentCase = { id: undefined as string | undefined };
  const reranker = rerankLog ? recordingReranker(cached, rerankLog, () => currentCase.id) : cached;

  return {
    tenantId: asTenantId(tenantId),
    config,
    currentCase,
    embedder,
    deps: {
      chat,
      shopify: new MockShopifyClient(),
      knowledge: new PgKnowledgeSearcher(asTenantId(tenantId), embedder, reranker),
      gaps: new PgGapRecorder(asTenantId(tenantId)),
      // The partial-class experiment: admit the reranker's middle verdict, or
      // not. Kept as an override rather than a config edit so one run can name
      // one variable.
      ...(arg('admits') ? { configOverrides: { retrievalAdmits: admitsArg() } } : {}),
      logger: createLogger({ level: 'error', write: (line) => process.stderr.write(`${line}\n`) }),
    },
  };
};

const execute = async () => {
  const { tenantId, config, currentCase, embedder, deps } = await build();
  const only = arg('only')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const all = loadCases(suiteName);
  const cases = only.length > 0 ? all.filter((c) => only.includes(c.id)) : all;
  if (only.length > 0 && cases.length !== only.length) {
    const missing = only.filter((id) => !cases.some((c) => c.id === id));
    throw new Error(`--only names cases that do not exist: ${missing.join(', ')}`);
  }
  process.stderr.write(
    `${cases.length} cases · ${deps.chat.spec.key} · pacing ${deps.chat.spec.quota?.requestsPerMinute ?? '∞'}/min\n`,
  );

  const adjudications = loadAdjudications(join(CASES_DIR, '..', 'adjudications.json'), suiteName);

  const result = await runSuite({
    tenantId,
    suite: suiteName,
    deps,
    cases,
    adjudications,
    productionChatModel: config.productionChatModel,
    onCaseStart: (testCase) => {
      currentCase.id = testCase.id;
    },
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
    // The full outcomes, for analysis the report does not carry — which cases
    // retrieved nothing, what each cited, the raw model text behind a
    // suppression. The report is for reading; this is for asking questions of.
    const outJson = arg('out-json');
    if (outJson) writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);
    await persistRun(tenantId, result);
    if (has('baseline') && (result.incompleteCases ?? 0) > 0) {
      console.error(
        `Refusing to record a baseline: ${result.incompleteCases} case(s) never reached the model.\n` +
          'A baseline from an incomplete run makes the next diff meaningless. Re-run when quota allows.',
      );
    } else if (has('baseline')) {
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
