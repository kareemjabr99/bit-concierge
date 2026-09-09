-- Extensions must exist before any table that uses their types.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgvector 0.8.0 introduced iterative index scans. Without them an HNSW query
-- carrying a WHERE clause (ours always filters tenant_id and embedding_model)
-- silently returns fewer rows than LIMIT asks for. Fail loudly rather than ship
-- a retriever that quietly under-returns. See docs/adr/0004-embeddings.md.
DO $$
DECLARE installed text;
BEGIN
  SELECT extversion INTO installed FROM pg_extension WHERE extname = 'vector';
  IF string_to_array(installed, '.')::int[] < ARRAY[0, 8, 0] THEN
    RAISE EXCEPTION
      'pgvector % is too old — 0.8.0 or newer is required for iterative index scans', installed;
  END IF;
END $$;
