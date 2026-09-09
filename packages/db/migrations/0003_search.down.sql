DROP INDEX IF EXISTS chunk_embeddings_scope_idx;
DROP INDEX IF EXISTS chunk_embeddings_hnsw_idx;
DROP INDEX IF EXISTS chunks_content_trgm_idx;
DROP INDEX IF EXISTS chunks_fts_idx;
ALTER TABLE chunks DROP COLUMN IF EXISTS fts;
DROP FUNCTION IF EXISTS bitc_ts_config(text);
