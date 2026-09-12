ALTER TABLE tenant_config ALTER COLUMN reranker SET DEFAULT 'fusion';
ALTER TABLE tenant_config ALTER COLUMN retrieval_min_score SET DEFAULT 0.35;

UPDATE tenant_config
SET reranker = 'fusion', retrieval_min_score = 0.35
WHERE reranker = 'llm:google:gemini-3.5-flash-lite' AND retrieval_min_score = 0.75;
