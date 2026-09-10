import { sql } from 'drizzle-orm';
import type { Language, TenantId } from '@bitc/core';
import { withTenant } from '@bitc/db';

/**
 * Questions retrieval could not answer above threshold, grouped and deduped.
 *
 * This is a commercial deliverable, not telemetry: it is the list of things a
 * merchant's customers ask that their own site does not answer, which is the
 * argument for writing the missing page. Surfaced in the admin dashboard.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'do',
  'does',
  'did',
  'can',
  'could',
  'i',
  'my',
  'me',
  'you',
  'your',
  'we',
  'our',
  'it',
  'to',
  'of',
  'for',
  'in',
  'on',
  'at',
  'and',
  'or',
  'what',
  'how',
  'when',
  'where',
  'please',
  'hi',
  'hello',
  'there',
  'any',
  'with',
  'about',
  'from',
  'هل',
  'في',
  'من',
  'على',
  'عن',
  'ما',
  'لو',
  'انا',
  'أنا',
  'لي',
  'عندي',
  'ممكن',
  'كيف',
  'متى',
  'وين',
]);

/**
 * Collapses phrasings of the same question so the report counts questions
 * rather than wordings. Lowercased, punctuation and diacritics dropped,
 * function words removed, remaining words sorted — "how long is shipping" and
 * "shipping how long?" become one row.
 */
export const normaliseQuestion = (question: string): string =>
  question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .sort()
    .join(' ')
    .slice(0, 300);

/** The @bitc/agent GapRecorder, over the database. */
export class PgGapRecorder {
  private readonly tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this.tenantId = tenantId;
  }

  async record(gap: GapRecord): Promise<void> {
    await recordKnowledgeGap(this.tenantId, gap);
  }
}

export interface GapRecord {
  question: string;
  lang: Language;
  /** Best retrieval score seen — how close we were to answering it. */
  bestScore: number | null;
}

export const recordKnowledgeGap = async (tenantId: TenantId, gap: GapRecord): Promise<void> => {
  const normalised = normaliseQuestion(gap.question);
  if (!normalised) return;
  await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      insert into knowledge_gaps (tenant_id, question_norm, question_sample, lang, best_score)
      values (${tenantId}, ${normalised}, ${gap.question}, ${gap.lang}, ${gap.bestScore})
      on conflict (tenant_id, lang, question_norm) do update set
        occurrences = knowledge_gaps.occurrences + 1,
        last_seen = now(),
        best_score = greatest(coalesce(knowledge_gaps.best_score, 0), coalesce(excluded.best_score, 0))
    `),
  );
};

export interface KnowledgeGapRow extends Record<string, unknown> {
  question_sample: string;
  lang: string;
  occurrences: number;
  best_score: number | null;
  first_seen: string;
  last_seen: string;
}

/** The report, most-asked first. */
export const knowledgeGaps = async (tenantId: TenantId, limit = 50): Promise<KnowledgeGapRow[]> =>
  withTenant(tenantId, async (tx) => {
    const rows = await tx.execute<KnowledgeGapRow>(sql`
      select question_sample, lang, occurrences, best_score, first_seen, last_seen
      from knowledge_gaps
      where status = 'open'
      order by occurrences desc, last_seen desc
      limit ${limit}
    `);
    return [...rows];
  });
