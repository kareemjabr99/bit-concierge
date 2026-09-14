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
    /**
     * Proof that "the corpus does not cover this" was checked rather than
     * assumed.
     *
     * Five expectations have now been written on the strength of a belief
     * about what a storefront publishes, and all five were wrong in the same
     * direction — the corpus answered the question. Three were still in the
     * set at the Phase 2 gate: order tracking, the 72-hour activation window,
     * and the list of countries eligible for free shipping. **Every one would
     * have scored a correctly grounded answer as a fabrication.**
     *
     * So an absence is not a thing an author may simply believe. `terms` are
     * substrings run against the indexed chunk text, `matchedChunks` is what
     * came back, and it has to be zero. A substring search does not care what
     * the reranker thought, which is the whole point: three of those five were
     * retrieval failures written down as facts about the corpus.
     *
     * Checked with `pnpm --filter @bitc/rag run grep -- --count <terms>` and
     * re-checked against the live index by
     * `pnpm --filter @bitc/evals run verify-absence`, because a corpus that
     * gains the content makes a recorded absence stale rather than wrong.
     */
    absenceCheck: z
      .object({
        terms: z.array(z.string().min(3)).min(1),
        matchedChunks: z.number().int().min(0),
        checkedAt: z.string().min(10),
      })
      .optional(),
    /**
     * Why a hand-over is the right answer, when no citation is expected.
     *
     * `corpus-silent` is the only ground a corpus search can settle, and it
     * requires `absenceCheck`. The rest are grounds no published policy could
     * ever change: moving money, identifying a customer, a question about
     * live checkout state, an adversarial turn, or something simply outside
     * what a store assistant does.
     *
     * A field rather than a phrase in the notes, because the first version of
     * this rule read the prose and an author could pass it by rewording.
     * Naming the ground is a claim someone can disagree with.
     */
    escalationGround: z
      .enum(['corpus-silent', 'money', 'identity', 'tool-only', 'adversarial', 'out-of-scope'])
      .optional(),
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
  /**
   * Against the CURRENT expectations. Never reported without the figure below
   * beside it — a number that moves when an expectation is rewritten needs the
   * unrewritten one next to it or it is not a measurement.
   */
  accuracy: number;
  /**
   * Against the expectations as first drafted, counting every adjudicated case
   * as the failure it originally was.
   */
  accuracyAsOriginallyScored: number;
  /** How many cases have had their expectation changed, with evidence. */
  adjudicatedCases: number;
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
