-- Tenant isolation, enforced by Postgres rather than by discipline.
--
-- Two roles:
--   bitc_migrator  owns the schema, runs migrations, is NOT used by the app
--   bitc_app       the application role; row-level security applies to it
--
-- The app sets app.tenant_id inside a transaction (SET LOCAL semantics) and
-- every policy reads it back. A query with no tenant in scope matches nothing,
-- which is the correct failure mode: empty, never everyone's.
-- See docs/adr/0003-multi-tenancy.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bitc_migrator') THEN
    CREATE ROLE bitc_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bitc_app') THEN
    CREATE ROLE bitc_app NOLOGIN;
  END IF;
END $$;

-- NULL rather than an error when unset: policies then match nothing, and the
-- application-level guard in withTenant() is what produces a readable error.
CREATE OR REPLACE FUNCTION bitc_current_tenant()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Tenant resolution happens before a tenant is in scope, so it cannot go
-- through a policy. These are the only two SECURITY DEFINER functions in the
-- system. They return an id and nothing else — no row, no token, no config.
CREATE OR REPLACE FUNCTION bitc_resolve_tenant_by_shop(p_shop text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM tenants WHERE shopify_domain = p_shop AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION bitc_resolve_tenant_by_widget_key(p_key text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM tenants WHERE widget_public_key = p_key AND status = 'active'
$$;

REVOKE ALL ON FUNCTION bitc_resolve_tenant_by_shop(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bitc_resolve_tenant_by_widget_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitc_resolve_tenant_by_shop(text) TO bitc_app;
GRANT EXECUTE ON FUNCTION bitc_resolve_tenant_by_widget_key(text) TO bitc_app;
GRANT EXECUTE ON FUNCTION bitc_current_tenant() TO bitc_app;

-- `tenants` is keyed on id; every other table carries tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (id = bitc_current_tenant())
  WITH CHECK (id = bitc_current_tenant());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_config', 'shopify_installs', 'documents', 'chunks', 'chunk_embeddings',
    'knowledge_gaps', 'conversations', 'messages', 'escalation_digests', 'escalations',
    'order_lookup_attempts', 'conversation_tombstones', 'eval_runs', 'usage_daily'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = bitc_current_tenant())'
      || ' WITH CHECK (tenant_id = bitc_current_tenant())',
      t || '_isolation', t
    );
  END LOOP;
END $$;

-- The app role may read and write rows. It may not change the shape of
-- anything, and it holds no BYPASSRLS.
GRANT USAGE ON SCHEMA public TO bitc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bitc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bitc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bitc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bitc_app;

-- Migration bookkeeping is infrastructure, not tenant data. The app role has
-- no business reading it.
REVOKE ALL ON TABLE bitc_migrations FROM bitc_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
