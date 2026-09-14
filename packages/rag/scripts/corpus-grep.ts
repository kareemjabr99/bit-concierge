/**
 * Substring search over the indexed chunk text.
 *
 * Exists because "retrieval found nothing" and "the corpus contains nothing"
 * are different claims, and one of them was recorded as the other. A case note
 * said the corpus had no order-tracking instructions; it has them, on two
 * pages, disagreeing. What had been measured was the reranker scoring those
 * chunks 0.5 and the threshold excluding them.
 *
 * A substring search does not care what the reranker thought, which is exactly
 * why it is the check an absence claim has to pass. See
 * packages/evals/src/adjudication.ts.
 *
 *   pnpm --filter @bitc/rag run grep -- "tracking number"
 *   pnpm --filter @bitc/rag run grep -- --count "gift wrap" "Tabby" "opening hours"
 */
import { sql } from 'drizzle-orm';
import { asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey, withTenant } from '@bitc/db';

const args = process.argv.slice(2).filter((a) => a !== '--');
const countOnly = args.includes('--count');
const terms = args.filter((a) => !a.startsWith('--'));

if (terms.length === 0) {
  console.error('usage: pnpm --filter @bitc/rag run grep -- [--count] <term> [term...]');
  process.exit(1);
}

const widgetKey = process.env.BITC_TENANT ?? 'pk_dev_1886';
const resolved = await resolveTenantByWidgetKey(widgetKey);
if (!resolved) {
  console.error(`No active tenant for "${widgetKey}". Run: pnpm db:seed`);
  process.exit(1);
}
const tenantId = asTenantId(resolved);

interface Row extends Record<string, unknown> {
  source_id: string;
  content: string;
}

let absent = 0;
for (const term of terms) {
  const rows = await withTenant(tenantId, async (tx) => {
    const result = await tx.execute<Row>(sql`
      SELECT d.source_id, c.content
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.content ILIKE ${`%${term}%`}
      ORDER BY d.source_id
      LIMIT 20`);
    return result as unknown as Row[];
  });

  if (rows.length === 0) absent += 1;
  console.log(`\n"${term}" — ${rows.length} chunk(s)${rows.length === 0 ? '  ABSENT' : ''}`);
  if (countOnly) continue;
  for (const row of rows) {
    const at = row.content.toLowerCase().indexOf(term.toLowerCase());
    const excerpt = row.content
      .slice(Math.max(0, at - 140), at + 180)
      .replace(/\s+/g, ' ')
      .trim();
    console.log(`  [${row.source_id}] …${excerpt}…`);
  }
}

console.log(`\n${absent} of ${terms.length} term(s) absent from the index.`);
await disconnect();
