/**
 * Prints every failing case with the evidence needed to decide whether the
 * AGENT was wrong or the CASE was wrong.
 *
 * This exists because one of the first thirty-three drafted cases had a wrong
 * expectation — it asserted a question was unanswerable when the corpus
 * answered it — and the failure looked exactly like an agent failure until
 * someone read the source. Reviewing a failure without the reply and the
 * retrieved sources in front of you is guessing.
 *
 *   pnpm evals adjudicate [--suite en-core]
 *
 * Reads the last run's rows from the database, so it costs no model calls.
 */
import { sql } from 'drizzle-orm';
import { asTenantId } from '@bitc/core';
import { disconnect, resolveTenantByWidgetKey, withTenant } from '@bitc/db';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : fallback;
};

const tenantId = asTenantId((await resolveTenantByWidgetKey(arg('tenant', 'pk_dev_1886')))!);
const limit = Number(arg('limit', '40'));

interface Row extends Record<string, unknown> {
  external_id: string;
  role: string;
  content: string | null;
  grounding: unknown;
  retrieval_hits: unknown;
  tool_calls: unknown;
  created_at: string;
}

const rows = await withTenant(tenantId, async (tx) => {
  const result = await tx.execute<Row>(sql`
    select c.external_id, m.role, m.content, m.grounding, m.retrieval_hits, m.tool_calls, m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
    where c.external_id like 'eval-%'
    order by m.created_at desc
    limit ${limit * 4}
  `);
  return [...result];
});

// Group by case, newest run first.
const byCase = new Map<string, Row[]>();
for (const row of rows) {
  const id = row.external_id.replace(/^eval-[^-]*-/, '');
  if (!byCase.has(id)) byCase.set(id, []);
  byCase.get(id)!.push(row);
}

const titlesFor = async (chunkIds: string[]): Promise<string[]> => {
  if (chunkIds.length === 0) return [];
  const found = await withTenant(tenantId, async (tx) => {
    const result = await tx.execute<{ source_id: string; heading: string | null }>(sql`
      select d.source_id, array_to_string(c.heading_path, ' › ') as heading
      from chunks c join documents d on d.id = c.document_id
      where c.id = any(${sql.raw(`ARRAY[${chunkIds.map((id) => `'${id}'::uuid`).join(',')}]`)})
    `);
    return [...result];
  });
  return found.map((f) => `${f.source_id}${f.heading ? ` (${f.heading})` : ''}`);
};

for (const [caseId, messages] of byCase) {
  const assistant = messages.find((m) => m.role === 'assistant');
  const user = messages.find((m) => m.role === 'user');
  if (!assistant) continue;

  const grounding = assistant.grounding as {
    status?: string;
    rawModelText?: string;
    literal?: { misses?: unknown[] };
    citations?: { misses?: { reason: string; sentence: string; concepts: string[] }[] };
  } | null;
  const hits = (assistant.retrieval_hits as { chunkId: string; score: number }[] | null) ?? [];
  const tools = ((assistant.tool_calls as { name: string; ok: boolean }[] | null) ?? []).map(
    (t) => `${t.name}${t.ok ? '' : '✗'}`,
  );

  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${caseId}   [${grounding?.status ?? '?'}]   tools: ${tools.join(', ') || 'none'}`);
  console.log(`  asked:     ${(user?.content ?? '').slice(0, 150)}`);
  console.log(
    `  replied:   ${(assistant.content ?? '(withheld)').replace(/\n/g, ' ').slice(0, 260)}`,
  );
  if (grounding?.rawModelText && grounding.rawModelText !== assistant.content) {
    console.log(`  model said: ${grounding.rawModelText.replace(/\n/g, ' ').slice(0, 260)}`);
  }
  if (hits.length > 0) {
    const titles = await titlesFor(hits.map((h) => h.chunkId));
    console.log(
      `  retrieved: ${hits
        .map((h, i) => `${h.score.toFixed(2)} ${titles[i] ?? '?'}`)
        .join(' | ')
        .slice(0, 220)}`,
    );
  } else {
    console.log('  retrieved: nothing above threshold');
  }
  for (const miss of grounding?.citations?.misses ?? []) {
    console.log(
      `  gate:      ${miss.reason} [${miss.concepts.join(',')}] "${miss.sentence.slice(0, 120)}"`,
    );
  }
  console.log(
    '  → was the AGENT wrong, or was the CASE wrong? If the corpus answers it, the agent. If it does not, the case.',
  );
}

await disconnect();
