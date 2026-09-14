/**
 * Re-runs every recorded absence check against the live index.
 *
 * `expect.absenceCheck` records what was true of the corpus on a date. A
 * corpus is not a fixed thing — the merchant's exports added a privacy policy
 * and replaced three others in one afternoon — so a recorded absence does not
 * stay true, it goes stale. A case asserting the corpus cannot answer a
 * question the corpus has since started answering will score a correct answer
 * as a fabrication, which is the failure this whole mechanism exists to
 * prevent, arriving by a slower route.
 *
 * Needs a database, so it is not part of `pnpm test`. Run it before a gate and
 * after any ingest.
 *
 *   pnpm --filter @bitc/evals run verify-absence
 */
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey, withTenant } from '@bitc/db';
import { suiteFile } from '../src/types.ts';

const widgetKey = process.env.BITC_TENANT ?? 'pk_dev_1886';
const resolved = await resolveTenantByWidgetKey(widgetKey);
if (!resolved) {
  console.error(`No active tenant for "${widgetKey}". Run: pnpm db:seed`);
  process.exit(1);
}
const tenantId = asTenantId(resolved);

// Resolved against the repo root, not the package this runs from. The same
// path bug bit the ingest script; a glob that matches nothing reports success.
const CASES_GLOB = `${fileURLToPath(new URL('../cases', import.meta.url))}/**/*.json`;
const cases = globSync(CASES_GLOB).flatMap(
  (path) => suiteFile.parse(JSON.parse(readFileSync(path, 'utf8'))).cases,
);
const checked = cases.filter((c) => c.expect.absenceCheck);
if (cases.length === 0) {
  console.error(`No case files matched ${CASES_GLOB}. Refusing to report success on nothing.`);
  await disconnect();
  process.exit(1);
}

const countFor = async (term: string): Promise<number> =>
  withTenant(tenantId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM chunks c WHERE c.content ILIKE ${`%${term}%`}`)) as unknown as {
      n: number;
    }[];
    return rows[0]?.n ?? 0;
  });

console.log(`\nre-checking ${checked.length} recorded absence(s) against the live index\n`);

const stale: { id: string; term: string; now: number }[] = [];
for (const testCase of checked) {
  const check = testCase.expect.absenceCheck!;
  const hits: string[] = [];
  for (const term of check.terms) {
    const n = await countFor(term);
    if (n > 0) {
      stale.push({ id: testCase.id, term, now: n });
      hits.push(`"${term}" → ${n}`);
    }
  }
  const status = hits.length === 0 ? 'still absent' : `NOW PRESENT: ${hits.join(', ')}`;
  console.log(`  ${testCase.id.padEnd(34)} checked ${check.checkedAt}  ${status}`);
}

console.log('');
if (stale.length > 0) {
  console.error(
    `${stale.length} recorded absence(s) are stale. The corpus now contains content these ` +
      `cases assert is missing, so each would score a correct answer as a fabrication.\n` +
      `Re-read the case, fix the expectation, and record the adjudication.`,
  );
  await disconnect();
  process.exit(1);
}
console.log(`All ${checked.length} absences still hold.`);
await disconnect();
