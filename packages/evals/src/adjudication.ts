import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * A record of a case whose expectation was changed after a run disagreed
 * with it.
 *
 * This exists because a metric that can be improved by redefining failure is
 * not a metric. Two of the first 103 drafted cases genuinely had wrong
 * expectations — and the moment that is true once, every subsequent failure
 * becomes reclassifiable, and accuracy stops measuring anything.
 *
 * So reclassification is not free. Each one carries the evidence that forced
 * it, the report shows the score both ways for ever, and a case whose corpus
 * support is ambiguous stays a failure.
 */
export const adjudication = z.object({
  caseId: z.string().min(3),
  /** What the case asserted before. Kept so the original score stays computable. */
  originalBehaviour: z.enum(['answer', 'escalate', 'refuse']),
  newBehaviour: z.enum(['answer', 'escalate', 'refuse']),
  /**
   * The sources retrieval actually returned, with scores. Required, and
   * required to be non-empty when the change makes a case easier to pass:
   * "the corpus does not support this" is a claim about the corpus, and it is
   * made by looking.
   */
  retrievedSources: z
    .array(z.object({ sourceId: z.string(), score: z.number(), excerpt: z.string().min(10) }))
    .default([]),
  /** Why the corpus does not support the original expectation. Prose, specific. */
  rationale: z.string().min(60),
  /** Who decided. A name, so a reader can ask them. */
  adjudicatedBy: z.string().min(2),
  adjudicatedAt: z.string().min(10),
});

export type Adjudication = z.infer<typeof adjudication>;

export const adjudicationFile = z.object({
  suite: z.string(),
  adjudications: z.array(adjudication),
});

/**
 * A reclassification that makes a case easier to pass needs sources. One that
 * makes it harder does not — nobody games a metric downwards.
 */
export const isRelaxation = (a: Adjudication): boolean =>
  a.originalBehaviour !== a.newBehaviour && a.newBehaviour !== 'answer';

export const validate = (adjudications: Adjudication[]): string[] => {
  const problems: string[] = [];
  for (const a of adjudications) {
    if (a.originalBehaviour === a.newBehaviour) {
      problems.push(`${a.caseId}: records no change`);
    }
    if (a.retrievedSources.length === 0) {
      problems.push(
        `${a.caseId}: no retrieved sources. A case is not reclassified without the corpus in front of you.`,
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
