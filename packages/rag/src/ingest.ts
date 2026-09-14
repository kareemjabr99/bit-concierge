import { and, eq, sql } from 'drizzle-orm';
import { contentHash, type Language, type TenantId } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { Embedder } from '@bitc/models';
import { chunk, type ChunkOptions } from './chunk.ts';

export type SourceType = 'product' | 'collection' | 'page' | 'article' | 'policy' | 'upload';

export interface IngestDocument {
  sourceType: SourceType;
  /** Stable within (tenant, sourceType): a handle, a page path, an upload id. */
  sourceId: string;
  url?: string | null;
  title?: string | null;
  lang: Language;
  content: string;
  metadata?: Record<string, unknown>;
}

export type IngestStatus = 'created' | 'updated' | 'unchanged' | 'embedded';

export interface IngestResult {
  documentId: string;
  sourceId: string;
  status: IngestStatus;
  chunks: number;
  embedded: number;
}

export interface IngestDeps {
  embedder: Embedder;
  chunkOptions?: ChunkOptions;
}

/**
 * One document in, chunks and vectors out.
 *
 * Unchanged content costs nothing: the content hash short-circuits before any
 * embedding call. A document whose text is unchanged but which has no vectors
 * for the tenant's active embedding model is re-embedded without re-chunking —
 * that is the path a model cutover takes, and it is why the model is part of
 * the embedding key rather than a column on the chunk.
 */
export const ingestDocument = async (
  tenantId: TenantId,
  doc: IngestDocument,
  deps: IngestDeps,
): Promise<IngestResult> => {
  const hash = contentHash(doc.content);
  const model = deps.embedder.spec;

  const existing = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.documents.id, contentHash: schema.documents.contentHash })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, tenantId),
          eq(schema.documents.sourceType, doc.sourceType),
          eq(schema.documents.sourceId, doc.sourceId),
        ),
      );
    if (!row) return undefined;
    const [counts] = await tx
      .select({
        chunks: sql<number>`count(distinct ${schema.chunks.id})::int`,
        vectors: sql<number>`count(${schema.chunkEmbeddings.chunkId})::int`,
      })
      .from(schema.chunks)
      .leftJoin(
        schema.chunkEmbeddings,
        and(
          eq(schema.chunkEmbeddings.chunkId, schema.chunks.id),
          eq(schema.chunkEmbeddings.embeddingModel, model.key),
        ),
      )
      .where(eq(schema.chunks.documentId, row.id));
    return { ...row, chunks: counts?.chunks ?? 0, vectors: counts?.vectors ?? 0 };
  });

  if (
    existing &&
    existing.contentHash === hash &&
    existing.chunks > 0 &&
    existing.vectors === existing.chunks
  ) {
    return {
      documentId: existing.id,
      sourceId: doc.sourceId,
      status: 'unchanged',
      chunks: existing.chunks,
      embedded: 0,
    };
  }

  const pieces = chunk(
    { content: doc.content, title: doc.title ?? undefined, url: doc.url ?? undefined },
    deps.chunkOptions,
  );
  if (pieces.length === 0) {
    throw new Error(`Document ${doc.sourceType}/${doc.sourceId} produced no chunks`);
  }

  // Embed before writing: a provider failure must not leave a document indexed
  // with no vectors, which retrieval would silently never return.
  const vectors = await deps.embedder.embedDocuments(pieces.map((p) => p.content));

  const documentId = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.documents)
      .values({
        tenantId,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        url: doc.url ?? null,
        title: doc.title ?? null,
        lang: doc.lang,
        content: doc.content,
        contentHash: hash,
        metadata: doc.metadata ?? {},
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.documents.tenantId, schema.documents.sourceType, schema.documents.sourceId],
        set: {
          url: doc.url ?? null,
          title: doc.title ?? null,
          lang: doc.lang,
          content: doc.content,
          contentHash: hash,
          metadata: doc.metadata ?? {},
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.documents.id });

    const id = row!.id;
    // Chunk boundaries move when content does; replacing them is cheaper and
    // safer than diffing. Vectors cascade.
    await tx.delete(schema.chunks).where(eq(schema.chunks.documentId, id));

    const inserted = await tx
      .insert(schema.chunks)
      .values(
        pieces.map((piece) => ({
          documentId: id,
          tenantId,
          ordinal: piece.ordinal,
          content: piece.content,
          headingPath: piece.headingPath,
          url: piece.url,
          lang: doc.lang,
          tokenCount: piece.tokenCount,
        })),
      )
      .returning({ id: schema.chunks.id, ordinal: schema.chunks.ordinal });

    const byOrdinal = new Map(inserted.map((c) => [c.ordinal, c.id]));
    await tx.insert(schema.chunkEmbeddings).values(
      pieces.map((piece, index) => ({
        chunkId: byOrdinal.get(piece.ordinal)!,
        tenantId,
        embeddingModel: model.key,
        embeddingDims: model.dims,
        embedding: vectors[index]!,
      })),
    );
    return id;
  });

  return {
    documentId,
    sourceId: doc.sourceId,
    status: existing ? 'updated' : 'created',
    chunks: pieces.length,
    embedded: pieces.length,
  };
};

/**
 * Backfills vectors for a second embedding model without touching content.
 * New rows land beside the old ones; nothing is deleted until the tenant's
 * config has been flipped and the cutover verified. See ADR 0004.
 */
export const backfillEmbeddings = async (
  tenantId: TenantId,
  deps: IngestDeps & { batchSize?: number },
): Promise<{ embedded: number; alreadyPresent: number }> => {
  const model = deps.embedder.spec;
  const batchSize = deps.batchSize ?? 32;
  let embedded = 0;

  const pending = await withTenant(tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; content: string }>(sql`
      select c.id, c.content from chunks c
      where not exists (
        select 1 from chunk_embeddings ce
        where ce.chunk_id = c.id and ce.embedding_model = ${model.key}
      )
      order by c.id
    `);
    return [...rows];
  });

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await deps.embedder.embedDocuments(batch.map((row) => row.content));
    await withTenant(tenantId, (tx) =>
      tx.insert(schema.chunkEmbeddings).values(
        batch.map((row, index) => ({
          chunkId: row.id,
          tenantId,
          embeddingModel: model.key,
          embeddingDims: model.dims,
          embedding: vectors[index]!,
        })),
      ),
    );
    embedded += batch.length;
  }

  const total = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.chunks);
    return row?.n ?? 0;
  });
  return { embedded, alreadyPresent: total - embedded };
};

/** Removes vectors for a superseded model, after a cutover is verified. */
export const dropEmbeddings = async (tenantId: TenantId, modelKey: string): Promise<number> =>
  withTenant(tenantId, async (tx) => {
    const rows = await tx
      .delete(schema.chunkEmbeddings)
      .where(eq(schema.chunkEmbeddings.embeddingModel, modelKey))
      .returning({ id: schema.chunkEmbeddings.chunkId });
    return rows.length;
  });

/**
 * Removes documents that a merchant export replaces.
 *
 * A Shopify store publishes each policy twice — /policies/x and /pages/x — and
 * the two are not always identical. On this corpus they disagree about how
 * long an order takes to process. Once the merchant has handed over the
 * authoritative text, a second rendering of the same policy is not extra
 * coverage, it is a coin toss about which figure a customer is told.
 *
 * Chunks and their embeddings go with the document, by cascade.
 */
export const deleteDocuments = async (
  tenantId: TenantId,
  sourceIds: string[],
): Promise<{ sourceId: string; chunks: number }[]> => {
  if (sourceIds.length === 0) return [];
  return withTenant(tenantId, async (tx) => {
    const removed: { sourceId: string; chunks: number }[] = [];
    for (const sourceId of sourceIds) {
      const [doc] = await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.tenantId, tenantId), eq(schema.documents.sourceId, sourceId)),
        );
      if (!doc) continue;
      const [counted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.chunks)
        .where(eq(schema.chunks.documentId, doc.id));
      await tx.delete(schema.documents).where(eq(schema.documents.id, doc.id));
      removed.push({ sourceId, chunks: counted?.n ?? 0 });
    }
    return removed;
  });
};
