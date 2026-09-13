import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * A record of a case whose expectation was changed after a run disagreed
 * with it.
 *
 * This exists because a metric that can be improved by redefining failure is
 * not a metric. Some drafted cases genuinely are wrong — and the moment that
 * is true once, every subsequent failure becomes reclassifiable, and accuracy
 * stops measuring anything.
 *
 * So reclassification is not free. Each one carries the evidence that forced
 * it, the report shows the score both ways for ever, and a case whose corpus
 * support is ambiguous stays a failure.
 */

/**
 * What was looked at before deciding the case was wrong.
 *
 * Two shapes, because there are two ways a corpus can settle a question and
 * the first version of this file only admitted one. Requiring retrieved
 * sources made the most common legitimate adjudication — "I searched and the
 * corpus does not cover this" — impossible to record, which would have left
 * the choice between leaving a self-contradicting case broken and editing it
 * with no record at all. Absence is evidence; it just has to be evidence
 * someone else can re-run.
 */
const sourcesFound = z.object({
  kind: z.literal('sources'),
  sources: z
    .array(z.object({ sourceId: z.string(), score: z.number(), excerpt: z.string().min(10) }))
    .min(1),
});

const nothingFound = z.object({
  kind: z.literal('absence'),
  /** The exact queries run. Without these the claim is unfalsifiable. */
  queries: z.array(z.string().min(3)).min(1),
  /** The best score any candidate reached, so "nothing" is a number. */
  bestScore: z.number(),
  /** Where else this was checked — the crawl notes, the live page. */
  alsoChecked: z.string().min(10),
});

export const evidence = z.discriminatedUnion('kind', [sourcesFound, nothingFound]);

export const adjudication = z.object({
  caseId: z.string().min(3),
  /**
   * What changed. Behaviour is the common one, but a case can be wrong in its
   * content expectations too — and those were outside this constraint
   * entirely until a `mustNotContain` turned out to be catching correct
   * answers. An expectation editable without a record is an expectation that
   * will be edited without a record.
   */
  field: z.enum(['behaviour', 'mustContain', 'mustNotContain', 'citesAnyOf', 'mustCallTools']),
  /** What the case asserted before. Kept so the original score stays computable. */
  originalBehaviour: z.enum(['answer', 'escalate', 'refuse']),
  newBehaviour: z.enum(['answer', 'escalate', 'refuse']),
  /** For non-behaviour fields: what the values were, and what they became. */
  originalValue: z.array(z.string()).default([]),
  newValue: z.array(z.string()).default([]),
  evidence,
  /** Why the corpus does not support the original expectation. Prose, specific. */
  rationale: z.string().min(60),
  /** Who decided. A name, so a reader can ask them. */
  adjudicatedBy: z.string().min(2),
  adjudicatedAt: z.string().min(10),
});

export type Adjudication = z.infer<typeof adjudication>;
export type Evidence = z.infer<typeof evidence>;

export const adjudicationFile = z.object({
  suite: z.string(),
  adjudications: z.array(adjudication),
});

/**
 * The shape worth being strictest about: an expectation edited to match what
 * the agent happened to do. Every adjudication is that, in practice — nobody
 * reclassifies a case they are passing — which is why the evidence rule has
 * no exemption rather than a carve-out for the "safe" direction.
 */
export const matchesObserved = (a: Adjudication, observedBehaviour: string): boolean =>
  a.field === 'behaviour' && a.newBehaviour === observedBehaviour;

export const validate = (adjudications: Adjudication[]): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const a of adjudications) {
    if (seen.has(`${a.caseId}:${a.field}`)) {
      problems.push(`${a.caseId}: ${a.field} adjudicated twice`);
    }
    seen.add(`${a.caseId}:${a.field}`);

    if (a.field === 'behaviour') {
      if (a.originalBehaviour === a.newBehaviour) problems.push(`${a.caseId}: records no change`);
    } else if (JSON.stringify(a.originalValue) === JSON.stringify(a.newValue)) {
      problems.push(`${a.caseId}: records no change to ${a.field}`);
    }

    // Evidence is required in both shapes; the schema guarantees each is
    // non-empty. This catches the one thing the schema cannot: an absence
    // claim asserting nothing was found when something scored well.
    if (a.evidence.kind === 'absence' && a.evidence.bestScore >= 0.75) {
      problems.push(
        `${a.caseId}: claims the corpus does not cover this, but a candidate scored ` +
          `${a.evidence.bestScore}. That is not an absence.`,
      );
    }
  }
  return problems;
};

export const loadAdjudications = (path: string, suite: string): Adjudication[] => {
  if (!existsSync(path)) return [];
  const parsed = adjudicationFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (parsed.suite !== suite) return [];
  const problems = validate(parsed.adjudications);
  if (problems.length > 0) {
    throw new Error(`Invalid adjudications:\n  ${problems.join('\n  ')}`);
  }
  return parsed.adjudications;
};
