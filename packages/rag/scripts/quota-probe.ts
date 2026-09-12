/**
 * Measures what the embedding free tier actually allows.
 *
 * The ingest hit `embed_content_free_tier_requests, limit: 100` and the
 * provider's retry-after values counted down within a minute, which suggests a
 * per-minute ceiling rather than a daily one — but "suggests" is not a number
 * anyone should plan Phase 5 around. This sends unique texts as fast as it can
 * and records where the wall is and how long it takes to come down.
 *
 *   pnpm --filter @bitc/rag quota-probe -- [--n 140]
 *
 * It deliberately does NOT use the cache: the point is to spend quota.
 */
import { readEnv } from '@bitc/core';
import { resolveEmbedder } from '@bitc/models';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const total = Number(arg('n', '140'));
const models = readEnv('models');
const embedder = resolveEmbedder('google:gemini-embedding-001@1536', {
  googleApiKey: models.GOOGLE_GENERATIVE_AI_API_KEY,
});

const started = Date.now();
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

let ok = 0;
let firstFailureAt: number | null = null;
let firstRetryAfter: string | null = null;
let recoveredAt: number | null = null;

console.log(`sending ${total} unique single-text embeddings, unpaced`);

for (let i = 0; i < total; i += 1) {
  try {
    await embedder.embedQuery(`quota probe ${started} item ${i} unique text`);
    ok += 1;
    if (firstFailureAt !== null && recoveredAt === null) {
      recoveredAt = ok;
      console.log(`  ${elapsed()}  recovered after the wall, at request ${i + 1}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = /retry in ([0-9.]+)s/.exec(message)?.[1];
    if (firstFailureAt === null) {
      firstFailureAt = ok;
      firstRetryAfter = retry ?? 'unstated';
      const limit = /limit: (\d+)/.exec(message)?.[1] ?? '?';
      console.log(
        `  ${elapsed()}  WALL after ${ok} successful requests · provider says limit ${limit} · retry in ${firstRetryAfter}s`,
      );
      // Wait out what the provider asked for, then see whether it comes back.
      const waitMs = Math.ceil(Number(retry ?? 30) * 1000) + 2000;
      console.log(`  waiting ${(waitMs / 1000).toFixed(0)}s …`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

console.log('');
console.log(`succeeded: ${ok} / ${total} in ${elapsed()}`);
if (firstFailureAt === null) {
  console.log(`No wall reached. The ceiling is above ${total} requests in ${elapsed()}.`);
} else {
  console.log(`Wall at ${firstFailureAt} requests; provider asked for ${firstRetryAfter}s.`);
  console.log(
    recoveredAt === null
      ? 'Did not recover within the run — consistent with a DAILY cap.'
      : `Recovered after waiting — consistent with a PER-MINUTE ceiling, not a daily cap.`,
  );
}
