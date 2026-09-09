# 0002 — Neon Postgres in Frankfurt, with portability as a hard constraint

**Status:** accepted, Phase 0 · **Date:** 2026-09-10

## Context

One database serves relational data, vector search and the job queue. Saudi
PDPL applies to the pilot merchant's customer records. The legal read on whether
that requires in-kingdom or in-GCC residency is running in parallel and is not
settled.

## Decision

**Neon**, `eu-central-1` (Frankfurt), on a paid plan with scale-to-zero
disabled.

**Plain Postgres only.** No vendor authentication, edge functions, object
storage or realtime. The entire datastore must be movable to AWS `me-central-1`
with a `pg_dump`, a `pg_restore` and a connection-string change.

This constraint is not a preference and is not to be eroded for convenience. Any
change that makes the database non-portable needs a new ADR superseding this one.

## Why Neon

- It **is** plain Postgres. Supabase's product surface is precisely the set of
  features this ADR forbids; choosing it would mean permanently resisting the
  platform we are paying for. Neon has no such surface to resist.
- pgvector tracks the current release and one back, updatable with
  `ALTER EXTENSION`. We control which version we run, which matters because
  migration 0001 requires ≥ 0.8.0 for iterative index scans.
- Point-in-time restore, and branching — genuinely useful for rehearsing a
  migration or pinning eval fixtures to a known database state.
- `pg_dump` output restores into stock Postgres. Portability is real, not
  claimed.

Fly Managed Postgres was rejected: it is the youngest option, it is
Supabase-managed underneath in any case, and putting the database with the app
at one vendor concentrates the blast radius.

## Residency

Neither Fly, Neon nor Supabase has a Gulf region. Confirmed 2026-09-10.

- Phases 0–4 run on synthetic and development-store data. Residency does not
  bind until real customer records enter at pilot go-live.
- Until the legal read lands, Frankfurt with a documented transfer basis.
- Residency stays a **Phase 6 configuration**: `tenant_config.data_region`
  exists from Phase 0 so the concept is in the schema before it is needed.
- If the read comes back requiring in-kingdom or in-GCC storage, the move is
  AWS `me-south-1` (Bahrain) or `me-central-1` (UAE) with self-managed
  Postgres. The portability constraint above is what keeps that a migration
  rather than a rewrite.

## Consequences

- Use Neon's **pooled** connection string. Transaction-mode pooling is
  compatible with our tenant scoping, because `set_config(..., true)` is
  transaction-local and cannot leak to the next borrower of a connection.
- Scale-to-zero must stay off. A cold start on the chat hot path is a customer
  waiting.
- pg-boss shares this database. Job payloads may carry customer identifiers, so
  they fall under the same retention rules as everything else — see ADR 0007.
