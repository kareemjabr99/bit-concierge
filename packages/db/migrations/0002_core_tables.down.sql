-- Reverse dependency order. CASCADE is deliberate: these tables only ever
-- reference each other, so nothing outside the migration can be caught by it.
DROP TABLE IF EXISTS usage_daily CASCADE;
DROP TABLE IF EXISTS eval_runs CASCADE;
DROP TABLE IF EXISTS order_lookup_attempts CASCADE;
DROP TABLE IF EXISTS conversation_tombstones CASCADE;
DROP TABLE IF EXISTS escalations CASCADE;
DROP TABLE IF EXISTS escalation_digests CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS knowledge_gaps CASCADE;
DROP TABLE IF EXISTS chunk_embeddings CASCADE;
DROP TABLE IF EXISTS chunks CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS shopify_installs CASCADE;
DROP TABLE IF EXISTS tenant_config CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
