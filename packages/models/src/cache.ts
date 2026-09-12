import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Embedder, EmbeddingModelSpec } from './embed.ts';

/**
 * A disk-backed embedding cache, for the eval harness rather than production.
 *
 * Two reasons, and the second is the important one:
 *
 *  - The free tier meters embedding requests per text, and a hundred-case suite
 *    spends that budget on every run. Cached query vectors make repeat runs and
 *    same-day diffs free.
 *  - An eval that re-embeds the same hundred queries every run measures the
 *    embedding endpoint's variance along with everything else. Cached query
 *    vectors make a run repeatable, so a diff between two runs is a difference
 *    in the thing being tested.
 *
 * It wraps any Embedder and is chosen by the harness. The agent loop resolves
 * its embedder from the registry and never sees this, so swapping to a paid
 * key is not an exercise in unpicking accommodations. See ADR 0006.
 */

export interface EmbeddingCacheOptions {
  /** Directory for the cache files. Safe to delete at any time. */
  dir: string;
  /** When false, every call goes to the provider. */
  read?: boolean;
  /** When false, results are not written back. */
  write?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
}

const keyFor = (spec: EmbeddingModelSpec, task: 'document' | 'query', text: string): string =>
  createHash('sha256').update(`${spec.key} ${task} ${text}`).digest('hex');

export const cachedEmbedder = (
  inner: Embedder,
  options: EmbeddingCacheOptions,
): Embedder & { stats: CacheStats } => {
  const stats: CacheStats = { hits: 0, misses: 0 };
  const read = options.read ?? true;
  const write = options.write ?? true;
  mkdirSync(options.dir, { recursive: true });

  // Two-character shard: a flat directory of thousands of files is slow to
  // list and unpleasant to look at.
  const pathFor = (key: string): string => join(options.dir, key.slice(0, 2), `${key}.json`);

  const load = (key: string): number[] | undefined => {
    if (!read) return undefined;
    const file = pathFor(key);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : undefined;
    } catch {
      // A truncated cache file is a cache miss, never a failure.
      return undefined;
    }
  };

  const save = (key: string, vector: number[]): void => {
    if (!write) return;
    const file = pathFor(key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(vector));
  };

  return {
    spec: inner.spec,
    stats,
    async embedDocuments(texts) {
      const keys = texts.map((text) => keyFor(inner.spec, 'document', text));
      const out: (number[] | undefined)[] = keys.map(load);
      const missing = out
        .map((vector, index) => (vector ? -1 : index))
        .filter((index) => index >= 0);
      stats.hits += out.length - missing.length;
      stats.misses += missing.length;
      if (missing.length > 0) {
        const fresh = await inner.embedDocuments(missing.map((index) => texts[index]!));
        missing.forEach((index, n) => {
          out[index] = fresh[n]!;
          save(keys[index]!, fresh[n]!);
        });
      }
      return out as number[][];
    },
    async embedQuery(text) {
      const key = keyFor(inner.spec, 'query', text);
      const hit = load(key);
      if (hit) {
        stats.hits += 1;
        return hit;
      }
      stats.misses += 1;
      const vector = await inner.embedQuery(text);
      save(key, vector);
      return vector;
    },
  };
};
