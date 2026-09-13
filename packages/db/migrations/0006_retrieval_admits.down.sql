ALTER TABLE tenant_config
  ADD COLUMN retrieval_min_score real NOT NULL DEFAULT 0.75;

UPDATE tenant_config
SET retrieval_min_score = CASE WHEN retrieval_admits = 'relevant' THEN 0.75 ELSE 0.5 END;

ALTER TABLE tenant_config DROP CONSTRAINT tenant_config_retrieval_admits_check;
ALTER TABLE tenant_config DROP COLUMN retrieval_admits;
