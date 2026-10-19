-- The job queue's schema: where pg-boss keeps its tables.
--
-- pg-boss (ADR 0001, 0002) shares this database. It installs and upgrades its
-- own tables, versioned by its own `version` table, so they are not written
-- out here: copying its generated SQL into a checksummed migration would mean
-- a hand-written migration for every pg-boss release, and an upgrade that
-- forgets one fails at the worker's start rather than here.
--
-- What this migration owns is the boundary. The schema is separate from
-- `public`, where every table carries tenant_id and a policy (0004), so
-- nothing pg-boss creates can collide with a tenant table or be mistaken for
-- one that lost its policy. The application role may create objects in this
-- schema and nowhere else; in `public` it still changes no shape.
--
-- Job payloads carry ids only — a tenant id and a row id — never customer
-- text. The row is read under withTenant() by the job, so the queue holds no
-- tenant data to isolate. See packages/core/src/jobs.ts.
CREATE SCHEMA IF NOT EXISTS pgboss;
GRANT USAGE, CREATE ON SCHEMA pgboss TO bitc_app;
