# 0004 — Vectors in their own table, 1536 dimensions

**Status:** accepted, Phase 0 · **Date:** 2026-09-10
**Supersedes:** the brief's `chunks.embedding` column

## Context

The brief puts `embedding`, `embedding_model` and `embedding_dims` on `chunks`,
so that changing embedding model cannot silently mix incompatible vectors.

Postgres cannot deliver that on one table. A `vector` column has one fixed
dimension and an index has one dimension. Per-chunk dimensions there is a
comment, not a constraint — the design permits exactly the failure it was
written to prevent.

## Decision

### Split the table

`chunks` holds content, ordinal, heading path, language, source URL and
metadata. `chunk_embeddings` holds vectors:

```
chunk_embeddings(chunk_id, tenant_id, embedding_model, embedding_dims, embedding)
PRIMARY KEY (chunk_id, embedding_model)
```

The model is part of the key. Retrieval always filters on the tenant's active
`embedding_model`, so mixing is impossible by construction rather than by
discipline.

Re-indexing writes new rows beside the old ones. Cutover is one config flip per
tenant. Superseded rows are deleted afterwards. No downtime, no destructive step.

### 1536 dimensions

`gemini-embedding-001` emits 3072. pgvector caps HNSW on the `vector` type at 2000. The options were `halfvec(3072)` or Matryoshka truncation to 1536.

1536 halves index memory, keeps the plain `vector` type and its tooling, and MRL
exists for this truncation.

**Moving to `halfvec(3072)` is a migration plus a backfill, not a re-ingest.**
Source documents and chunk text are untouched; only `chunk_embeddings` gains a
column and rows. A new dimension family gets its own column and partial index in
a migration, and the model registry maps model → (column, dimensions, operator
class). Nothing is re-fetched from Shopify and nothing is re-chunked.

> If that turns out not to hold — if a dimension change forces re-chunking or
> re-ingestion for any reason — **raise it before Phase 2 closes**, because it
> changes the cost of the D3 decision.

### Indexes are hand-written

`drizzle-kit push` regenerates HNSW DDL without the operator class, which
Postgres rejects (known open bug, May 2026). `push` is not used in any
environment. `generate` authors table DDL, which is then reviewed; vector
indexes, the generated `tsvector` column and all RLS live in hand-authored SQL.
`packages/db/test/schema-drift.test.ts` walks every Drizzle-declared table and
column and asserts the database has it, which is what makes hand-written
migrations safe.

### pgvector ≥ 0.8.0 is required

Migration 0001 fails the deployment otherwise. Iterative index scans, added in
0.8, fix HNSW returning fewer rows than `LIMIT` when a `WHERE` clause filters
hard — and our every query filters `tenant_id` and `embedding_model`. Without
it, retrieval quietly under-returns, which is the worst kind of bug in a system
whose ship bar is about what it fails to know.

## Consequences

- Retrieval joins `chunks` to `chunk_embeddings`. Indexed on both sides.
- `embedding_dims` carries a check constraint pinning it to 1536. A second
  dimension family relaxes that check in the same migration that adds it.
- Verified on Postgres 18.6 with pgvector 0.8.6.
