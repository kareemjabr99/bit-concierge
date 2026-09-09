import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import {
  admin,
  app,
  prepareDatabase,
  seedTenant,
  truncateAll,
  TENANT_SCOPED_TABLES,
  type SeededTenant,
} from './helpers.ts';

/**
 * The isolation proof. Section 2 of the brief requires tenant separation to be
 * enforced by the database, not by application code, so this suite talks raw
 * SQL as the application role — no ORM, no helper that could be doing the
 * filtering for us. If a policy is missing, these fail.
 */
describe('row-level security', () => {
  let adminSql: postgres.Sql;
  let appSql: postgres.Sql;
  let alpha: SeededTenant;
  let beta: SeededTenant;

  beforeAll(async () => {
    await prepareDatabase();
    adminSql = admin();
    appSql = app();
    await truncateAll(adminSql);
    alpha = await seedTenant(adminSql, 'alpha');
    beta = await seedTenant(adminSql, 'beta');
  });

  afterAll(async () => {
    await truncateAll(adminSql);
    await adminSql.end();
    await appSql.end();
  });

  /** Runs fn with a tenant in scope, the way withTenant() does. */
  const asTenant = async <T>(tenantId: string, fn: (tx: postgres.Sql) => Promise<T>): Promise<T> =>
    appSql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return fn(tx as unknown as postgres.Sql);
    }) as Promise<T>;

  it('the application role does not bypass row-level security', async () => {
    const [row] = await appSql.unsafe<{ superuser: boolean | null; bypass: boolean }[]>(
      `SELECT (SELECT usesuper FROM pg_user WHERE usename = current_user) AS superuser,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
    );
    expect(row?.superuser ?? false).toBe(false);
    expect(row?.bypass).toBe(false);
  });

  it.each(TENANT_SCOPED_TABLES)('%s shows only the scoped tenant', async (table) => {
    const seen = await asTenant(alpha.id, (tx) =>
      tx.unsafe<{ tenant_id: string }[]>(`SELECT tenant_id FROM ${table}`),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.tenant_id))).toEqual(new Set([alpha.id]));
  });

  it.each(TENANT_SCOPED_TABLES)('%s hides everything when no tenant is in scope', async (table) => {
    const seen = await appSql.unsafe<unknown[]>(`SELECT * FROM ${table}`);
    expect(seen).toHaveLength(0);
  });

  it('tenants shows only the scoped row', async () => {
    const rows = await asTenant(alpha.id, (tx) =>
      tx.unsafe<{ id: string }[]>(`SELECT id FROM tenants`),
    );
    expect(rows.map((r) => r.id)).toEqual([alpha.id]);
  });

  it('cannot read another tenant even by naming its id explicitly', async () => {
    const rows = await asTenant(alpha.id, (tx) =>
      tx.unsafe<unknown[]>(`SELECT * FROM messages WHERE tenant_id = $1`, [beta.id]),
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot insert a row belonging to another tenant', async () => {
    await expect(
      asTenant(alpha.id, (tx) =>
        tx.unsafe(
          `INSERT INTO knowledge_gaps (tenant_id, question_norm, question_sample, lang)
           VALUES ($1, 'smuggled', 'smuggled', 'en')`,
          [beta.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update another tenant’s row', async () => {
    const updated = await asTenant(alpha.id, (tx) =>
      tx.unsafe<unknown[]>(
        `UPDATE conversations SET status = 'closed' WHERE tenant_id = $1 RETURNING id`,
        [beta.id],
      ),
    );
    expect(updated).toHaveLength(0);

    const [still] = await adminSql.unsafe<{ status: string }[]>(
      `SELECT status FROM conversations WHERE tenant_id = $1`,
      [beta.id],
    );
    expect(still?.status).toBe('open');
  });

  it('cannot delete another tenant’s row', async () => {
    await asTenant(alpha.id, (tx) =>
      tx.unsafe(`DELETE FROM messages WHERE tenant_id = $1`, [beta.id]),
    );
    const [{ count } = { count: '0' }] = await adminSql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM messages WHERE tenant_id = $1`,
      [beta.id],
    );
    expect(Number(count)).toBe(1);
  });

  it('cannot relabel its own row into another tenant', async () => {
    await expect(
      asTenant(alpha.id, (tx) =>
        tx.unsafe(`UPDATE knowledge_gaps SET tenant_id = $1 WHERE tenant_id = $2`, [
          beta.id,
          alpha.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('resolves a tenant by shop and by widget key, returning only an id', async () => {
    const [byShop] = await appSql.unsafe<{ id: string | null }[]>(
      `SELECT bitc_resolve_tenant_by_shop($1) AS id`,
      [beta.shop],
    );
    expect(byShop?.id).toBe(beta.id);

    const [byKey] = await appSql.unsafe<{ id: string | null }[]>(
      `SELECT bitc_resolve_tenant_by_widget_key($1) AS id`,
      [alpha.widgetKey],
    );
    expect(byKey?.id).toBe(alpha.id);

    const [missing] = await appSql.unsafe<{ id: string | null }[]>(
      `SELECT bitc_resolve_tenant_by_shop('nobody.myshopify.com') AS id`,
    );
    expect(missing?.id).toBeNull();
  });

  it('does not resolve a suspended tenant', async () => {
    await adminSql.unsafe(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [beta.id]);
    const [row] = await appSql.unsafe<{ id: string | null }[]>(
      `SELECT bitc_resolve_tenant_by_shop($1) AS id`,
      [beta.shop],
    );
    expect(row?.id).toBeNull();
    await adminSql.unsafe(`UPDATE tenants SET status = 'active' WHERE id = $1`, [beta.id]);
  });

  it('cannot read migration bookkeeping', async () => {
    await expect(appSql.unsafe(`SELECT * FROM bitc_migrations`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('cannot create tables', async () => {
    await expect(appSql.unsafe(`CREATE TABLE smuggled (id int)`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});
