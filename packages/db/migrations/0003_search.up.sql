-- Hybrid retrieval infrastructure: lexical (full text + trigram) and vector.
-- Hand-authored. drizzle-kit regenerates HNSW DDL without the operator class,
-- which Postgres rejects, so vector indexes never come from a generator.

-- Postgres 18 ships an `arabic` snowball configuration, so Arabic content gets
-- real stemming rather than the `simple` fallback. Verified against pg 18.6.
CREATE OR REPLACE FUNCTION bitc_ts_config(lang text)
RETURNS regconfig
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE lang
    WHEN 'ar' THEN 'arabic'::regconfig
    WHEN 'en' THEN 'english'::regconfig
    ELSE 'simple'::regconfig
  END
$$;

-- Stored generated column: the lexical arm of hybrid retrieval, kept in sync
-- with content by Postgres rather than by application code.
ALTER TABLE chunks
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector(bitc_ts_config(lang), content)) STORED;

CREATE INDEX chunks_fts_idx ON chunks USING gin (fts);

-- Trigram index carries fuzzy and Arabizi-adjacent matching, where stemming
-- has nothing to work with.
CREATE INDEX chunks_content_trgm_idx ON chunks USING gin (content gin_trgm_ops);

-- Cosine distance: embeddings are normalised, and cosine is what the retrieval
-- threshold is calibrated against.
CREATE INDEX chunk_embeddings_hnsw_idx
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

-- Every retrieval filters tenant_id and embedding_model before ranking.
CREATE INDEX chunk_embeddings_scope_idx
  ON chunk_embeddings (tenant_id, embedding_model);
