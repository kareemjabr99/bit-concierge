/**
 * The unscoped database handle. Row-level security still applies (the app role
 * holds no BYPASSRLS), but no tenant is set, so tenant-scoped queries match
 * nothing and writes fail their WITH CHECK.
 *
 * Application code must not import this — eslint's no-restricted-imports rule
 * blocks it outside packages/db. Use withTenant() from '@bitc/db'.
 *
 * Legitimate users: the migration runner, the tenant resolver, and health
 * checks. See docs/adr/0003-multi-tenancy.md.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let client: postgres.Sql | undefined;
let database: Database | undefined;

export interface ConnectOptions {
  url?: string;
  max?: number;
}

export const connect = (options: ConnectOptions = {}): Database => {
  if (database) return database;
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  database = drizzle(client, { schema });
  return database;
};

export const disconnect = async (): Promise<void> => {
  await client?.end();
  client = undefined;
  database = undefined;
};

/** Reset between tests. Not for application use. */
export const __resetForTests = (): void => {
  client = undefined;
  database = undefined;
};
