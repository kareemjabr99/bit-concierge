DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_config', 'shopify_installs', 'documents', 'chunks', 'chunk_embeddings',
    'knowledge_gaps', 'conversations', 'messages', 'escalation_digests', 'escalations',
    'order_lookup_attempts', 'conversation_tombstones', 'eval_runs', 'usage_daily'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS bitc_resolve_tenant_by_widget_key(text);
DROP FUNCTION IF EXISTS bitc_resolve_tenant_by_shop(text);
DROP FUNCTION IF EXISTS bitc_current_tenant();

-- Roles are left in place. They may own objects outside this migration's
-- knowledge, and dropping a role that does is an error, not a rollback.
