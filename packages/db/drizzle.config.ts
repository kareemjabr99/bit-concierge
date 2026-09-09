import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used to AUTHOR migration SQL, never to apply it. `push` is not
 * used in any environment: it regenerates HNSW index DDL without the operator
 * class, which Postgres rejects. Generated SQL is reviewed and hand-edited into
 * migrations/, which a small runner applies. See docs/adr/0004-embeddings.md.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './.drizzle-generated',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATOR ?? 'postgres://localhost/unused' },
});
