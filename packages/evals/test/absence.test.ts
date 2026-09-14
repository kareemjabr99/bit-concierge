import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suiteFile } from '../src/types.ts';

/**
 * An absence expectation that was never grep-verified is not writable.
 *
 * Five drafted expectations have now asserted that the corpus does not cover
 * something, and all five were wrong in the same direction. Three survived to
 * the Phase 2 gate — order-tracking instructions, the 72-hour activation
 * window, and the list of countries eligible for free shipping — and every one
 * of them would have scored a correctly grounded answer as a fabrication.
 *
 * The adjudication constraint already required a substring search before a
 * case could be reclassified. That is the wrong end of the process: it catches
 * the error after a run has been spent on it. This catches it at authoring
 * time, which is where all five were made.
 */

const SUITES = globSync('packages/evals/cases/**/*.json');

/**
 * Language that asserts something is missing from the corpus.
 *
 * The same detector used for the Phase 2 audit, where it found all 21 claims.
 * It is a heuristic and an author could dodge it by rewording — which is why
 * the second rule below does not depend on it.
 */
const CLAIMS_ABSENCE =
  /\b(?:absent|not (?:in|published|available|covered|listed)|no(?:t| )\w* (?:in the corpus|published)|does not (?:say|state|cover|enumerate|publish)|nothing (?:in|states)|never (?:offers?|states?|published)|unreachable|nowhere)\b/i;

const cases = SUITES.flatMap((path) =>
  suiteFile.parse(JSON.parse(readFileSync(path, 'utf8'))).cases.map((c) => ({ ...c, path })),
);

describe('absence expectations are checked, not believed', () => {
  it('is reading the suites it thinks it is', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  const claiming = cases.filter((c) => CLAIMS_ABSENCE.test(c.expect.notes));

  it('finds the cases that claim the corpus is silent', () => {
    expect(claiming.length).toBeGreaterThan(0);
  });

  it.each(claiming.map((c) => [c.id, c] as const))(
    '%s claims an absence and carries the search that verified it',
    (_id, testCase) => {
      const check = testCase.expect.absenceCheck;
      expect(
        check,
        `${testCase.id} asserts the corpus does not cover something, with no record that ` +
          `anyone looked.\nRun: pnpm --filter @bitc/rag run grep -- --count "<term>" ...\n` +
          `then record terms, matchedChunks and checkedAt in expect.absenceCheck.`,
      ).toBeDefined();
      expect(
        check!.matchedChunks,
        `${testCase.id} records ${check!.matchedChunks} matching chunk(s) and still claims ` +
          `the corpus is silent. Retrieval missing it is not the corpus lacking it.`,
      ).toBe(0);
    },
  );

  it.each(
    cases
      .filter(
        (c) =>
          (c.expect.behaviour === 'escalate' || c.expect.behaviour === 'refuse') &&
          c.expect.citesAnyOf.length === 0,
      )
      .map((c) => [c.id, c] as const),
  )('%s hands over, and names the ground it hands over on', (_id, testCase) => {
    // The rule the wording heuristic cannot be dodged past. Escalating with no
    // citation expected means the justification is either "the corpus is
    // silent" — which needs the search — or something no published policy
    // could ever settle, which has to be named rather than implied.
    const ground = testCase.expect.escalationGround;
    expect(
      ground,
      `${testCase.id} expects a hand-over and expects no citation, without saying why.\n` +
        `Set expect.escalationGround. Use 'corpus-silent' only with an absenceCheck.`,
    ).toBeDefined();
    if (ground === 'corpus-silent') {
      expect(
        testCase.expect.absenceCheck,
        `${testCase.id} claims the corpus is silent. That is the one ground a search can ` +
          `settle, so it needs expect.absenceCheck.`,
      ).toBeDefined();
    }
  });

  it('nothing claims the corpus is silent without having looked', () => {
    // The two fields together. A case can carry a search and a non-corpus
    // ground; it cannot claim silence without one.
    const unproven = cases.filter(
      (c) => c.expect.escalationGround === 'corpus-silent' && !c.expect.absenceCheck,
    );
    expect(unproven.map((c) => c.id)).toEqual([]);
  });
});
