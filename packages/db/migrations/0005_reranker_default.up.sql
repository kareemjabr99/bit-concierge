-- The retrieval threshold gates on whatever the reranker returns.
--
-- Phase 2 measured both. On cosine similarity from gemini-embedding-001,
-- answerable questions score 0.672-0.737 and unanswerable ones 0.592-0.625:
-- a real boundary, but 0.048 wide on a scale where everything sits between
-- 0.59 and 0.74. With an LLM reranker on flash-lite the same twelve questions
-- separate 1.000 against 0.000-0.500 — a gap ten times wider, with the middle
-- band occupied by questions that are on topic but do not answer.
--
-- So: reranker on by default, threshold above the "on topic but not the
-- answer" band. See docs/adr/0004-embeddings.md.
ALTER TABLE tenant_config ALTER COLUMN reranker SET DEFAULT 'llm:google:gemini-3.5-flash-lite';
ALTER TABLE tenant_config ALTER COLUMN retrieval_min_score SET DEFAULT 0.75;

UPDATE tenant_config
SET reranker = 'llm:google:gemini-3.5-flash-lite', retrieval_min_score = 0.75
WHERE reranker = 'fusion' AND retrieval_min_score = 0.35;
