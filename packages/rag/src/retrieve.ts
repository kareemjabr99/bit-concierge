import { eq, inArray, sql } from 'drizzle-orm';
import type { Language, TenantId } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { Embedder, Reranker } from '@bitc/models';
import type { KnowledgeHit, KnowledgeQuery, KnowledgeSearcher } from '@bitc/agent';

/**
 * Hybrid retrieval: HNSW cosine over pgvector, Postgres full text, and trigram
 * similarity, fused by reciprocal rank.
 *
 * Two scores, doing different jobs:
 *
 *   RRF decides ORDER. It combines ranks from arms whose scores are not
 *   comparable, which is the whole point of it — but the fused number means
 *   nothing on its own and must never be compared to a threshold.
 *
 *   Cosine similarity decides ADMISSION. It is 0–1, comparable across queries,
 *   and the admission policy in `tenant_config.retrieval_admits` decides
 *   which of its verdicts count as retrieved.
 *
 * Below the threshold the agent is told nothing was found, which is what makes
 * it escalate rather than reason its way to a plausible policy.
 */

const RRF_K = 60;

export interface RetrieveOptions {
  /** Candidates drawn from each arm before fusion. */
  candidates?: number;
  /** Trigram similarity floor for the fuzzy arm. */
  trigramThreshold?: number;
}

interface Row extends Record<string, unknown> {
  id: string;
  content: string;
  url: string | null;
  heading_path: string[];
  lang: string;
  title: string | null;
  sim: number | null;
  rrf: number;
}

export class PgKnowledgeSearcher implements KnowledgeSearcher {
  private readonly tenantId: TenantId;
  private readonly embedder: Embedder;
  private readonly reranker: Reranker;
  private readonly options: Required<RetrieveOptions>;

  constructor(
    tenantId: TenantId,
    embedder: Embedder,
    reranker: Reranker,
    options: RetrieveOptions = {},
  ) {
    this.tenantId = tenantId;
    this.embedder = embedder;
    this.reranker = reranker;
    this.options = {
      candidates: options.candidates ?? 20,
      trigramThreshold: options.trigramThreshold ?? 0.2,
    };
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeHit[]> {
    const hits = await this.run(query, query.lang);
    // Section 6: filter by language, fall back to the other when results are
    // thin. A customer asking in Arabic would rather have the English answer
    // than none.
    if (hits.length >= Math.min(2, query.topK)) return hits;
    const other = await this.run(query, query.lang === 'ar' ? 'en' : 'ar');
    return [...hits, ...other].slice(0, query.topK);
  }

  private async run(query: KnowledgeQuery, lang: Language): Promise<KnowledgeHit[]> {
    const vector = await this.embedder.embedQuery(query.query);
    const literal = `[${vector.join(',')}]`;
    const model = this.embedder.spec.key;
    const { candidates, trigramThreshold } = this.options;

    const rows = await withTenant(this.tenantId, async (tx) => {
      // pgvector 0.8: without this an HNSW scan under a WHERE clause returns
      // fewer rows than LIMIT asks for, and every query here filters.
      await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
      // SET LOCAL takes no bind parameters; set_config with `true` is the same
      // transaction-local scope and does.
      await tx.execute(
        sql`select set_config('pg_trgm.similarity_threshold', ${String(trigramThreshold)}, true)`,
      );
      const result = await tx.execute<Row>(sql`
        with vec as (
          select c.id,
                 row_number() over (order by ce.embedding <=> ${literal}::vector) as rnk
          from chunk_embeddings ce
          join chunks c on c.id = ce.chunk_id
          where ce.embedding_model = ${model} and c.lang = ${lang}
          order by ce.embedding <=> ${literal}::vector
          limit ${candidates}
        ),
        lex as (
          select c.id,
                 row_number() over (
                   order by ts_rank(c.fts, websearch_to_tsquery(bitc_ts_config(c.lang), ${query.query})) desc,
                            similarity(c.content, ${query.query}) desc
                 ) as rnk
          from chunks c
          where c.lang = ${lang}
            and (c.fts @@ websearch_to_tsquery(bitc_ts_config(c.lang), ${query.query})
                 or c.content % ${query.query})
          limit ${candidates}
        ),
        fused as (
          select id, min(vrank) as vrank, min(lrank) as lrank from (
            select id, rnk as vrank, null::bigint as lrank from vec
            union all
            select id, null::bigint, rnk from lex
          ) t group by id
        )
        select c.id, c.content, c.url, c.heading_path, c.lang, d.title,
               (1 - (ce.embedding <=> ${literal}::vector))::float8 as sim,
               (coalesce(1.0 / (${RRF_K} + f.vrank), 0) + coalesce(1.0 / (${RRF_K} + f.lrank), 0))::float8 as rrf
        from fused f
        join chunks c on c.id = f.id
        join documents d on d.id = c.document_id
        left join chunk_embeddings ce on ce.chunk_id = c.id and ce.embedding_model = ${model}
        order by rrf desc
        limit ${candidates}
      `);
      return [...result];
    });

    // Candidates arrive ordered by RRF and carrying cosine as their score. The
    // reranker may replace that score, and whatever it returns is what the
    // threshold compares against — see @bitc/models rerank.ts.
    const ranked = await this.reranker.rerank(
      query.query,
      rows.map((row) => ({
        id: row.id,
        text: row.content,
        score: row.sim === null ? 0 : Number(row.sim),
      })),
      query.topK,
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    const rerankedScore = new Map(ranked.map((candidate) => [candidate.id, candidate.score]));
    // A store publishes the same policy at /policies/x and /pages/x, so the
    // same paragraph arrives twice under two titles and fills the top-k
    // between them. Whichever scored higher survives. Document-level
    // de-duplication at ingest does not catch this: the pages differ by a
    // heading, their chunks do not.
    const seen = new Set<string>();
    const isDuplicate = (content: string): boolean => {
      const print = content
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .slice(0, 240);
      if (seen.has(print)) return true;
      seen.add(print);
      return false;
    };

    return ranked
      .map((candidate) => {
        const row = byId.get(candidate.id)!;
        return {
          chunkId: row.id,
          content: row.content,
          title: row.title,
          url: row.url,
          headingPath: row.heading_path ?? [],
          // Whatever the reranker judged. With `fusion` that is cosine, the
          // behaviour before a reranker existed; with an LLM reranker it is a
          // relevance score, which is the number worth thresholding.
          score: Number((rerankedScore.get(row.id) ?? 0).toFixed(4)),
        };
      })
      .filter((hit) => hit.score >= this.reranker.floors[query.admits] && !isDuplicate(hit.content))
      .slice(0, query.topK);
  }
}

/**
 * Turns cited chunk ids into something a customer can click.
 *
 * The gate works in chunk ids; a reader needs a title and a URL. Deduplicated
 * by document, because three chunks of one policy are one link to a person,
 * and ordered by title so the same answer renders the same way twice.
 *
 * Lives here rather than in the web app so that no HTTP layer needs a database
 * client — the widget endpoint has no business composing SQL.
 */
export const citationSources = async (
  tenantId: TenantId,
  chunkIds: string[],
): Promise<{ title: string; url: string | null }[]> => {
  if (chunkIds.length === 0) return [];
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ title: schema.documents.title, url: schema.documents.url })
      .from(schema.chunks)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.chunks.documentId))
      .where(inArray(schema.chunks.id, chunkIds));
    const byTitle = new Map<string, { title: string; url: string | null }>();
    for (const row of rows) {
      const title = row.title ?? 'Store policy';
      if (!byTitle.has(title)) byTitle.set(title, { title, url: row.url });
    }
    return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));
  });
};
