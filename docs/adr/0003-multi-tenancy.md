# 0003 — Row-level security from the first migration

**Status:** accepted, Phase 0 · **Date:** 2026-09-10
**Supersedes:** the brief's placement of RLS in Phase 6

## Context

The brief requires tenant isolation enforced at the database level, and
scheduled that work for Phase 6. Retrofitting it once six packages query freely
means re-auditing every one of them.

## Decision

Policies, roles and the access wrapper land in Phase 0. The adversarial probe
suite and the tenant provisioning flow stay in Phase 6 as written — Phase 6 then
proves isolation rather than introducing it.

### Two roles

| Role            | Purpose                                                 |
| --------------- | ------------------------------------------------------- |
| `bitc_migrator` | owns the schema, runs migrations, never used by the app |
| `bitc_app`      | the application role; RLS applies, holds no `BYPASSRLS` |

Both are `NOLOGIN` group roles. A login user is granted membership — locally
`bitc_app_local`, in production whatever the provider creates. RLS does not
apply to a table's owner, so the application must never connect as the migrator;
`assertAppRole()` fails at boot if it does.

### One way in

```ts
await withTenant(tenantId, async (tx) => {
  /* ... */
});
```

It opens a transaction and sets `app.tenant_id` inside it. Every policy reads it
back through `bitc_current_tenant()`. `set_config(..., true)` is
transaction-local, so this is safe behind a transaction-mode pooler.

When no tenant is in scope the setting is NULL, every policy matches nothing,
and queries return empty. **Empty is the correct failure mode — the alternative
is everyone's rows.**

eslint blocks `@bitc/db/unsafe` outside `packages/db`.

### Resolution happens before scope exists

Finding a tenant from a shop domain or a widget key cannot go through a policy,
because there is no tenant yet. Two `SECURITY DEFINER` functions —
`bitc_resolve_tenant_by_shop` and `bitc_resolve_tenant_by_widget_key` — are the
only privileged path in the system. They return a UUID and nothing else: no row,
no token, no configuration. `EXECUTE` is revoked from `PUBLIC` and granted only
to `bitc_app`. Neither resolves a suspended tenant.

## Verification

`packages/db/test/rls.test.ts` talks raw SQL as the application role, with no
ORM that could be doing the filtering for us. It walks all fourteen
tenant-scoped tables for reads, and covers cross-tenant insert, update, delete,
relabelling, unscoped access, migration bookkeeping and DDL.

The suite was **mutation-tested** on 2026-09-10: disabling RLS on `messages`
failed exactly four targeted assertions, and granting the app role `BYPASSRLS`
failed 35 of 39. It detects breaches rather than passing vacuously.

## Consequences

- Every query costs a transaction. Acceptable, and it is what makes the tenant
  setting safe under pooling.
- `shopify_installs.tenant_id` is nullable between the OAuth callback and tenant
  provisioning. Such rows are invisible under RLS by design; the OAuth write
  path in Phase 4 must run through a dedicated privileged route, not through
  `withTenant`.
- `eval_runs.tenant_id` is nullable, and null rows are invisible to the app
  role. CI eval runs should carry a tenant. One rule, no exceptions.
