# Runbook

On-call reference. Written as Phase 0 lands; sections are added as the systems
they describe start existing.

## The database will not migrate

```bash
pnpm db:status
```

**"pgvector X is too old"** — migration 0001 refuses to run below 0.8.0.
Iterative index scans are not optional for us; retrieval filters `tenant_id` and
`embedding_model` on every query and silently under-returns without them. Fix
the database, not the migration. On Neon: `ALTER EXTENSION vector UPDATE;`

**"Migration NNNN was edited after it was applied"** — someone changed a
migration that has already run somewhere. Write a new migration. Do not change
the checksum.

## Queries return nothing and the data is definitely there

Almost always a missing tenant scope. `withTenant()` sets `app.tenant_id` inside
a transaction; outside one, every policy matches nothing and every query is
empty. Empty is the designed failure mode — see ADR 0003.

Check what the connection thinks it is:

```sql
SELECT current_user, bitc_current_tenant();
```

If `current_user` is the migrator or a superuser, RLS is not applying at all and
the application is misconfigured. `assertAppRole()` should have caught this at
boot.

## The worker is not draining the queue

The worker must never scale to zero — a suspended worker looks exactly like
ingestion silently not working. Check `fly status -a bit-concierge-worker`
before looking at pg-boss.

## A tenant has hit its daily token cap

Expected behaviour: a graceful message, not an error. Raise
`tenant_config.max_tokens_per_day` for that tenant. No deploy needed.

> **Before a demo:** the demo tenant's daily cap is raised 5× by hand, and
> **reverted afterwards**. This is deliberate and is not automated. See ADR 0008.

## The merchant is getting escalation digests instead of individual emails

The tenant is above `max_escalations_per_hour` (default 20). Nothing was
dropped — every escalation is in the digest, with `delivery_status = 'digested'`.
Either the cap is too low for their volume or something upstream is
over-escalating. Check the escalation rate in the dashboard before raising it.

## A reply was suppressed

The grounding gate found a fact with no source, or a policy claim with no
resolvable chunk id. The verdict is on `messages.grounding`. A rising
suppression rate means the prompt or retrieval has degraded — it is a signal
worth alerting on, not noise to filter. See ADR 0005.
