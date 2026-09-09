import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index.ts';
import { admin, prepareDatabase } from './helpers.ts';

/**
 * Migrations are hand-authored, so nothing guarantees they match the Drizzle
 * schema the application types itself against. This walks every declared table
 * and column and asserts the database actually has it. It is the guard that
 * lets us hand-write SQL without drifting.
 */
describe('schema drift', () => {
  let sql: postgres.Sql;
  let live: Map<string, Set<string>>;

  beforeAll(async () => {
    await prepareDatabase();
    sql = admin();
    const rows = await sql.unsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    live = new Map();
    for (const row of rows) {
      if (!live.has(row.table_name)) live.set(row.table_name, new Set());
      live.get(row.table_name)!.add(row.column_name);
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  // Each table has its own literal type, so a narrowing predicate to the base
  // PgTable is rejected. The runtime check is the real guarantee here.
  const declared = Object.values(schema).filter(
    (value) => value instanceof PgTable,
  ) as unknown as PgTable[];

  it('declares at least the tables the brief calls for', () => {
    expect(declared.length).toBeGreaterThanOrEqual(15);
  });

  it('every declared table and column exists in the database', () => {
    const missing: string[] = [];
    for (const table of declared) {
      const config = getTableConfig(table);
      const columns = live.get(config.name);
      if (!columns) {
        missing.push(`table ${config.name}`);
        continue;
      }
      for (const column of config.columns) {
        if (!columns.has(column.name)) missing.push(`${config.name}.${column.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the generated full-text column the retriever depends on', () => {
    expect(live.get('chunks')?.has('fts')).toBe(true);
  });

  it('indexes vectors with an explicit operator class', async () => {
    const [row] = await sql.unsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'chunk_embeddings_hnsw_idx'`,
    );
    expect(row?.indexdef).toContain('USING hnsw');
    expect(row?.indexdef).toContain('vector_cosine_ops');
  });

  it('runs a pgvector new enough for iterative index scans', async () => {
    const [row] = await sql.unsafe<{ extversion: string }[]>(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    const [major = 0, minor = 0] = (row?.extversion ?? '0.0.0').split('.').map(Number);
    expect(major > 0 || minor >= 8).toBe(true);
  });

  it('stems Arabic rather than falling back to simple', async () => {
    const [row] = await sql.unsafe<{ v: string }[]>(
      `SELECT to_tsvector(bitc_ts_config('ar'), 'سياسة الإرجاع خلال أربعة عشر يوما')::text AS v`,
    );
    // 'الإرجاع' normalises to 'ارجاع' only if the arabic configuration is in use.
    expect(row?.v).toContain('ارجاع');
  });
});
