import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface Migration {
  version: string;
  name: string;
  upPath: string;
  downPath: string;
}

const BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS bitc_migrations (
    version    text PRIMARY KEY,
    name       text NOT NULL,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export const discover = async (dir: string = MIGRATIONS_DIR): Promise<Migration[]> => {
  const files = await readdir(dir);
  const ups = files.filter((f) => f.endsWith('.up.sql')).sort();
  return ups.map((file) => {
    const base = file.replace(/\.up\.sql$/, '');
    const version = base.split('_')[0] ?? base;
    return {
      version,
      name: base.slice(version.length + 1),
      upPath: join(dir, file),
      downPath: join(dir, `${base}.down.sql`),
    };
  });
};

const checksum = (sql: string): string =>
  createHash('sha256').update(sql).digest('hex').slice(0, 16);

type Sql = postgres.Sql<Record<string, never>>;

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
}

const applied = async (sql: Sql): Promise<AppliedRow[]> => {
  await sql.unsafe(BOOKKEEPING);
  return sql.unsafe<AppliedRow[]>(
    'SELECT version, name, checksum FROM bitc_migrations ORDER BY version',
  );
};

export interface RunnerEvents {
  onApply?: (m: Migration) => void;
  onRevert?: (m: Migration) => void;
}

/** Applies every pending migration, each in its own transaction. */
export const up = async (sql: Sql, events: RunnerEvents = {}): Promise<Migration[]> => {
  const done = new Map((await applied(sql)).map((r) => [r.version, r]));
  const pending: Migration[] = [];

  for (const migration of await discover()) {
    const body = await readFile(migration.upPath, 'utf8');
    const sum = checksum(body);
    const record = done.get(migration.version);

    if (record) {
      if (record.checksum !== sum) {
        throw new Error(
          `Migration ${migration.version}_${migration.name} was edited after it was applied. ` +
            `Write a new migration instead of changing history.`,
        );
      }
      continue;
    }

    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe('INSERT INTO bitc_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        migration.version,
        migration.name,
        sum,
      ]);
    });
    events.onApply?.(migration);
    pending.push(migration);
  }
  return pending;
};

/** Reverts the most recently applied migrations, newest first. */
export const down = async (
  sql: Sql,
  steps = 1,
  events: RunnerEvents = {},
): Promise<Migration[]> => {
  const done = await applied(sql);
  const all = new Map((await discover()).map((m) => [m.version, m]));
  const targets = done.slice(-steps).reverse();
  const reverted: Migration[] = [];

  for (const record of targets) {
    const migration = all.get(record.version);
    if (!migration) throw new Error(`No migration file for applied version ${record.version}`);
    const body = await readFile(migration.downPath, 'utf8');

    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe('DELETE FROM bitc_migrations WHERE version = $1', [migration.version]);
    });
    events.onRevert?.(migration);
    reverted.push(migration);
  }
  return reverted;
};

export const status = async (
  sql: Sql,
): Promise<{ version: string; name: string; applied: boolean }[]> => {
  const done = new Set((await applied(sql)).map((r) => r.version));
  return (await discover()).map((m) => ({
    version: m.version,
    name: m.name,
    applied: done.has(m.version),
  }));
};
