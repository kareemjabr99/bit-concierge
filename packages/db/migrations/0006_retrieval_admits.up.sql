-- retrieval_min_score implied a precision that was never there.
--
-- The reranker is a rubric prompt with three anchors, and Phase 2 measured
-- what that produces: across 93 searches and 234 scored candidates, 98.7% of
-- scores were exactly 0.00, 0.50 or 1.00. Every threshold in (0.5, 1.0]
-- therefore selects an identical set of candidates, and so does every
-- threshold in (0.0, 0.5]. The number had two reachable settings and four
-- characters of apparent calibration, and the 0.75 in it was chosen by
-- intuition before any score had been observed.
--
-- So the column says what the decision actually is. 'relevant' admits only
-- candidates the rubric called a direct answer; 'relevant_or_partial' also
-- admits the ones it called on-topic-but-not-answering.
--
-- Default is relevant_or_partial, on the A/B in docs/adr/0004-embeddings.md:
-- five recovered answers to questions the store publishes, against one
-- fabricated one. The numeric floor each policy implies belongs to the
-- reranker, which knows what its own scores mean; it is not a tenant setting.
ALTER TABLE tenant_config
  ADD COLUMN retrieval_admits text NOT NULL DEFAULT 'relevant_or_partial';

ALTER TABLE tenant_config
  ADD CONSTRAINT tenant_config_retrieval_admits_check
  CHECK (retrieval_admits IN ('relevant', 'relevant_or_partial'));

-- Carry existing rows across by what their number actually did.
UPDATE tenant_config
SET retrieval_admits = CASE WHEN retrieval_min_score > 0.5 THEN 'relevant' ELSE 'relevant_or_partial' END;

ALTER TABLE tenant_config DROP COLUMN retrieval_min_score;
