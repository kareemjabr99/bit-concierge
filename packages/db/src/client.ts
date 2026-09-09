import { sql } from 'drizzle-orm';
import { TenantScopeError, type TenantId } from '@bitc/core';
import { connect, type ConnectOptions, type Transaction } from './unsafe.ts';

/**
 * The only way application code reaches tenant data.
 *
 * Every call opens a transaction and sets app.tenant_id inside it, which is
 * what the row-level security policies read. Transaction-local means this is
 * safe behind a transaction-mode connection pooler: the setting cannot leak to
 * the next borrower of the connection.
 *
 * Forgetting to scope a query is not possible here; the alternative would be a
 * query that matched every tenant's rows, so the failure mode is a compile-time
 * one instead of a data breach. See docs/adr/0003-multi-tenancy.md.
 */
export const withTenant = async <T>(
  tenantId: TenantId,
  fn: (tx: Transaction) => Promise<T>,
  options: ConnectOptions = {},
): Promise<T> => {
  if (!tenantId) throw new TenantScopeError('withTenant called without a tenant id');

  const db = connect(options);
  return db.transaction(async (tx) => {
    // `true` scopes the setting to this transaction (SET LOCAL semantics).
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
};

/**
 * Tenant resolution runs before a tenant is in scope, so it goes through the
 * SECURITY DEFINER functions rather than a policy. They return an id and
 * nothing else.
 */
export const resolveTenantByShop = async (
  shop: string,
  options: ConnectOptions = {},
): Promise<TenantId | undefined> => {
  const db = connect(options);
  const rows = await db.execute<{ id: string | null }>(
    sql`select bitc_resolve_tenant_by_shop(${shop}) as id`,
  );
  return (rows[0]?.id ?? undefined) as TenantId | undefined;
};

export const resolveTenantByWidgetKey = async (
  key: string,
  options: ConnectOptions = {},
): Promise<TenantId | undefined> => {
  const db = connect(options);
  const rows = await db.execute<{ id: string | null }>(
    sql`select bitc_resolve_tenant_by_widget_key(${key}) as id`,
  );
  return (rows[0]?.id ?? undefined) as TenantId | undefined;
};

/**
 * Boot check. Row-level security does not apply to the role that owns the
 * tables, so connecting as the migrator would silently disable every policy.
 * Fail at startup rather than in production.
 */
export const assertAppRole = async (options: ConnectOptions = {}): Promise<void> => {
  const db = connect(options);
  const rows = await db.execute<{ role: string; superuser: boolean; bypass: boolean }>(
    sql`select current_user as role,
               (select usesuper from pg_user where usename = current_user) as superuser,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
  );
  const row = rows[0];
  if (!row) throw new TenantScopeError('Could not determine the connected database role');
  if (row.superuser || row.bypass) {
    throw new TenantScopeError(
      `Connected as "${row.role}", which bypasses row-level security. ` +
        `The application must connect as bitc_app.`,
    );
  }
};
