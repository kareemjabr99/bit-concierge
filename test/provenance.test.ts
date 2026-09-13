import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Enforces docs/fixtures.md.
 *
 * Fifteen of fifteen drafted fixture facts were wrong, and they shared one
 * shape: **something written to be provisional was later read as
 * authoritative, because nothing in it said which it was.** A rule that lives
 * only in a markdown file has exactly that problem — it is provisional by
 * construction and nothing reads it. So it lives here, where a violation is a
 * red build rather than a paragraph nobody opened.
 */

/** Files that stand in for, or configure, a tenant's own content. */
const FACT_FILES = [
  ...globSync('packages/*/src/**/mock/**/*.ts'),
  ...globSync('packages/*/src/**/fixture*.ts'),
  ...globSync('packages/*/src/seed.ts'),
];

/**
 * Literals shaped like a merchant's published terms: a window, a price, a
 * rate. Matching on shape rather than on filename is deliberate — the rule
 * should bind the day someone adds `7 days` to a file that previously held
 * only logic, without anyone remembering to add it to a list.
 */
const FACT_SHAPED =
  /\b\d+\s*(?:-|–|\s+to\s+)?\s*\d*\s*(?:business\s+)?(?:day|week|month|hour)s?\b|\bSAR\b|\b\d+\s*%/i;

/** Content invented to stand in for a tenant's, and unmistakably not theirs. */
const INVENTED = /\bINVENTED\b/;

/** Content taken from a real source, naming it and the date it was read. */
const SOURCED = /SOURCE:\s*\S+\s*\(checked \d{4}-\d{2}-\d{2}\)/;

describe('fixture provenance (docs/fixtures.md)', () => {
  it('is looking at the files it thinks it is', () => {
    // A guard on the guard. If a refactor moves these, the suite would
    // otherwise pass by matching nothing, and the rule would quietly stop
    // existing — which is the exact failure mode it was written for.
    expect(FACT_FILES).toEqual(
      expect.arrayContaining([
        'packages/agent/src/knowledge/fixture.ts',
        'packages/shopify/src/mock/fixtures.ts',
        'packages/db/src/seed.ts',
      ]),
    );
  });

  const asserting = FACT_FILES.filter((p) => FACT_SHAPED.test(readFileSync(p, 'utf8')));

  it('finds files that assert tenant facts', () => {
    expect(asserting.length).toBeGreaterThan(0);
  });

  it.each(asserting)('%s says whether its facts are invented or sourced', (path) => {
    const content = readFileSync(path, 'utf8');
    expect(
      INVENTED.test(content) || SOURCED.test(content),
      `${path} states facts about a tenant — windows, prices or rates — and says nothing ` +
        `about where they came from.\nAdd "INVENTED" or "SOURCE: <url> (checked YYYY-MM-DD)". ` +
        `Rule 3, docs/fixtures.md.`,
    ).toBe(true);
  });

  it('holds seeded tenant config to the sourced standard, not the invented one', () => {
    // Rule 2: configuration is not a fixture. These values reach a customer
    // through get_shipping_estimate, which presents them as the store's
    // published terms, and the citation gate accepts a tool result as a
    // source. "Invented" is not an available declaration here.
    const seed = readFileSync('packages/db/src/seed.ts', 'utf8');
    expect(
      SOURCED.test(seed),
      'packages/db/src/seed.ts reaches customers. Every fact in it needs a source and a date, ' +
        'not an INVENTED marker. Rule 2, docs/fixtures.md.',
    ).toBe(true);
    expect(
      INVENTED.test(seed),
      'packages/db/src/seed.ts carries an INVENTED marker. Configuration does not get one — ' +
        'it is sourced from the merchant or it is absent. Rule 2, docs/fixtures.md.',
    ).toBe(false);
  });

  it('keeps the fixture corpus unmistakable for the real one', () => {
    // Rule 1. The fixture corpus keeps values the real corpus contradicts on
    // purpose, so a test passing against it can never be mistaken for a test
    // passing against the merchant's actual policy.
    const fixture = readFileSync('packages/agent/src/knowledge/fixture.ts', 'utf8');
    expect(fixture).toMatch(/NOT 1886/);
    expect(fixture).toContain('14 days');
  });
});

describe('golden-set expectations (docs/fixtures.md rule 5)', () => {
  interface Case {
    id: string;
    expect: { behaviour: string; notes?: string };
  }

  const suites = globSync('packages/evals/cases/**/*.json');

  it('is looking at the suites it thinks it is', () => {
    expect(suites.length).toBeGreaterThan(0);
  });

  it.each(suites)('%s: every expectation records why', (path) => {
    const cases = (JSON.parse(readFileSync(path, 'utf8')) as { cases: Case[] }).cases;
    // Two of the first 103 cases were wrong, both assuming the corpus could
    // not answer when it could, and both written from intuition about what a
    // fashion store publishes. A note is not proof someone ran the query, but
    // an empty one is proof they did not write down what they found.
    const silent = cases.filter((c) => (c.expect.notes ?? '').trim().length < 20);
    expect(
      silent.map((c) => c.id),
      'These cases assert an expected behaviour without recording the corpus evidence for it.',
    ).toEqual([]);
  });
});
