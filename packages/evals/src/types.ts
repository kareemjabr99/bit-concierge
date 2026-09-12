import { z } from 'zod';

/**
 * A golden-set case.
 *
 * `validatedBy` is the whole point of the tier system. A case drafted from the
 * storefront proves the machinery works; only a case a person from the
 * merchant's side has signed counts toward the ship bar. A run is as validated
 * as its least-validated case, and the report never blends the two.
 */
export const evalCase = z.object({
  id: z.string().min(3),
  lang: z.enum(['en', 'ar']),
  /** What the customer types. Verbatim — including typos and Arabizi. */
  input: z.string().min(1),
  /** Prior turns, for cases about a conversation rather than a question. */
  history: z.array(z.string()).default([]),

  expect: z.object({
    /**
     * answer   — a grounded reply reaches the customer
     * escalate — the turn ends with a hand-over
     * refuse   — a reply that declines to reveal or promise, without escalating
     */
    behaviour: z.enum(['answer', 'escalate', 'refuse']),
    /** Case-insensitive substrings the reply must contain. */
    mustContain: z.array(z.string()).default([]),
    /** Substrings that would make the reply wrong. The sharpest signal here. */
    mustNotContain: z.array(z.string()).default([]),
    mustCallTools: z.array(z.string()).default([]),
    mustNotCallTools: z.array(z.string()).default([]),
    /** Document sourceIds, any one of which is an acceptable citation. */
    citesAnyOf: z.array(z.string()).default([]),
    /** Why this case exists and what a wrong answer would cost. */
    notes: z.string().default(''),
  }),

  /** Category, for reporting. Section 9 names the ones that must be covered. */
  category: z.enum([
    'returns',
    'shipping',
    'sizing',
    'care',
    'order-status',
    'identity',
    'stock',
    'escalation',
    'abuse',
    'store-info',
    'unanswerable',
    'injection',
  ]),

  /** Null until someone signs it. Only signed cases count toward the ship bar. */
  validatedBy: z.string().nullable().default(null),
  validatedAt: z.string().nullable().default(null),
});

export type EvalCase = z.infer<typeof evalCase>;

export const suiteFile = z.object({
  suite: z.string(),
  cases: z.array(evalCase),
});

export type Tier = 'provisional' | 'validated';

export const tierOf = (cases: EvalCase[]): Tier =>
  cases.length > 0 && cases.every((c) => c.validatedBy !== null) ? 'validated' : 'provisional';

export interface CaseOutcome {
  id: string;
  category: EvalCase['category'];
  lang: 'en' | 'ar';
  passed: boolean;
  /** Every expectation that did not hold, in words. */
  failures: string[];
  behaviour: string;
  expectedBehaviour: string;
  reply: string | null;
  rawModelText: string | null;
  toolsCalled: string[];
  citedSources: string[];
  retrievedSources: string[];
  /** Deterministic: literal facts absent from tool results. */
  hallucinations: number;
  /** Deterministic: policy claims with no resolvable, on-topic citation. */
  citationMisses: number;
  /** The reply was withheld although the case expected an answer. */
  falseSuppression: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface RunMetrics {
  cases: number;
  passed: number;
  failed: number;
  accuracy: number;
  /** Answered rather than escalated, over cases that should be answerable. */
  deflectionRate: number;
  /** Of the turns that escalated, how many should have. */
  escalationPrecision: number;
  /** Of cases naming acceptable sources, how many retrieved one. */
  retrievalHitRate: number;
  hallucinationCount: number;
  citationMissCount: number;
  falseSuppressionCount: number;
  p95LatencyMs: number;
  costPerConversationUsd: number | null;
}

export interface RunResult {
  suite: string;
  tier: Tier;
  gitSha: string;
  chatModel: string;
  embeddingModel: string;
  reranker: string;
  startedAt: string;
  metrics: RunMetrics;
  outcomes: CaseOutcome[];
  /** False unless every gate passed, including the model-binding check. */
  meetsShipBar: boolean;
  shipBarNotes: string[];
  /** Turns that never reached the model — a quota wall, not a quality signal. */
  incompleteCases?: number;
}
