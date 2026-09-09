import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { down, discover, status, up } from '../src/migrate.ts';
import { admin, prepareDatabase } from './helpers.ts';

describe('migrations', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    await prepareDatabase();
    sql = admin();
  });

  afterAll(async () => {
    await up(sql);
    await sql.end();
  });

  it('pairs every up with a down', async () => {
    const migrations = await discover();
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      expect(
        existsSync(migration.downPath),
        `${migration.version}_${migration.name} has no .down.sql`,
      ).toBe(true);
    }
  });

  it('reports every migration as applied', async () => {
    await up(sql);
    const rows = await status(sql);
    expect(rows.every((r) => r.applied)).toBe(true);
  });

  it('is idempotent — a second up applies nothing', async () => {
    await up(sql);
    expect(await up(sql)).toHaveLength(0);
  });

  it('refuses to run a migration that was edited after it was applied', async () => {
    await up(sql);
    await sql.unsafe(`UPDATE bitc_migrations SET checksum = 'tampered' WHERE version = '0002'`);
    await expect(up(sql)).rejects.toThrow(/edited after it was applied/);
    // Restore so later tests see a consistent database.
    await sql.unsafe(`DELETE FROM bitc_migrations`);
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await up(sql);
  });

  it('rolls all the way back and forward again', async () => {
    await up(sql);
    const applied = (await status(sql)).filter((s) => s.applied).length;
    await down(sql, applied);

    const [{ count: tables } = { count: '0' }] = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'bitc_migrations'`,
    );
    expect(Number(tables)).toBe(0);

    const [{ count: policies } = { count: '0' }] = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public'`,
    );
    expect(Number(policies)).toBe(0);

    await up(sql);
    expect((await status(sql)).every((s) => s.applied)).toBe(true);
  });
});
