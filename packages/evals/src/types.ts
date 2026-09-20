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
    /**
     * Other behaviours that are also correct for this case.
     *
     * Twelve of 103 cases were nondeterministic across two runs at identical
     * inputs, and every one flipped between two behaviours that were BOTH
     * right — handing over versus a safe refusal, answering versus the gate
     * withholding. Nothing leaked and nothing was invented. The suite was
     * encoding one acceptable answer where several exist and scoring the rest
     * as failures.
     *
     * **`answer` is deliberately not available here, and that is the point.**
     * A set may contain only behaviours that are independently safe: hand it
     * to a human, decline, or withhold. Two different factual answers can
     * never both be acceptable, and making that a type rather than a rule
     * means nobody has to remember it.
     *
     * Content expectations still apply to whichever behaviour occurs, so a
     * refusal that leaks an order number still fails.
     *
     * Widening a case requires an adjudication with evidence, one at a time —
     * see adjudication.ts. The count of cases using this is in every run
     * report, permanently.
     */
    alsoAcceptable: z.array(z.enum(['escalate', 'refuse', 'suppressed'])).default([]),
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
  /**
   * Why a turn ended in `error`. Quota and timeout call for opposite
   * responses, so the report names which.
   */
  errorKind?: 'timeout' | 'quota' | 'provider' | undefined;
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
  /**
   * THE BAR. Fabricated literals and uncited policy claims that reached a
   * customer, counted over delivered replies only.
   *
   * These are **properties, not percentages**. The gate inspects every reply
   * and withholds any that fails, so both are zero by construction — and that
   * is exactly why they are worth checking: if either ever goes above zero,
   * the guarantee has been broken rather than degraded. There is no threshold
   * to tune and no confidence interval to quote.
   */
  fabricatedLiteralsDelivered: number;
  uncitedClaimsDelivered: number;
  /**
   * How often the gate intervened. **Not a quality metric**, and not part of
   * the bar.
   *
   * This counts claims the gate CAUGHT and withheld. Quoting it as a defect
   * rate would be quoting how often the safety net was used as though it were
   * how often someone fell. It also inherits the model's nondeterminism —
   * across two runs at identical inputs it read 9 then 8, with only three of
   * eleven cases in common — so it is reported and never thresholded.
   */
  hallucinationCount: number;
  citationMissCount: number;
  /**
   * The cost the guarantee charges: replies withheld that should have been
   * sent. Reported alongside the bar, never a gate on it — tightening this
   * means loosening the gate, which is the wrong direction.
   */
  falseSuppressionCount: number;
  /**
   * Cases accepting more than one behaviour. Reported permanently and on
   * purpose: widening expectations is the move that turns a metric into a
   * formality, and a number that grows quietly is how that happens.
   */
  multiBehaviourCases: number;
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
