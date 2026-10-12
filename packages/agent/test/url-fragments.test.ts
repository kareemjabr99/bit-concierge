import { describe, expect, it } from 'vitest';
import { checkCitations, checkGrounding, urlGroundedBy } from '../src/index.ts';

/**
 * The fragment rule, in both gates that read URLs (src/guard/url-match.ts).
 *
 * A cited URL with no fragment is grounded by a returned URL with its fragment
 * stripped; a cited URL with a fragment must match a returned URL exactly.
 * Retrieval returns sections, so only the anchored URL is ever "returned".
 */

const PAGE = 'https://1886riyadh.com/policies/refund-policy';
const SECTION = `${PAGE}#online-purchases`;

/** What search_knowledge returned on 2026-10-11 for `returns-who-pays-pickup`, trimmed. */
const knowledge = {
  ok: true,
  results: [
    {
      id: '14bb2416-b39a-4791-b764-310d55d9c815',
      url: SECTION,
      content:
        'A pickup will be arranged with an additional shipping fee depending on your location.',
    },
  ],
};
const literal = (reply: string) =>
  checkGrounding({ reply, toolResults: [knowledge], toolsCalled: ['search_knowledge'] });

const sources = [
  { id: 'fx-pickup', url: SECTION, text: 'pickup additional shipping fee location' },
];
/** The URL is the sentence's only attribution: no marker. */
const attributed = (url: string) =>
  checkCitations({
    reply: `A pickup carries a shipping fee depending on location (${url}).`,
    sources,
  });

const MUST_FAIL: [string, string][] = [
  ['an invented fragment on a returned page', `${PAGE}#free-returns`],
  ['an invented fragment, upper-cased', `${PAGE}#FREE-RETURNS`],
  [
    'a different path on the same host, a prefix of the real one',
    'https://1886riyadh.com/policies/refund',
  ],
  [
    'a different path on the same host, a sibling',
    'https://1886riyadh.com/policies/shipping-policy',
  ],
  [
    'a different path that keeps the real fragment',
    'https://1886riyadh.com/policies/shipping-policy#online-purchases',
  ],
  ['a different host with the same path', 'https://1886-riyadh.example/policies/refund-policy'],
  [
    'a different host with the same path and fragment',
    'https://1886-riyadh.example/policies/refund-policy#online-purchases',
  ],
  ['a query string nobody returned', `${PAGE}?ref=returns`],
];

describe('URL fragments', () => {
  describe('the literal gate', () => {
    it('accepts the bare page when only a section of it was returned — real transcript', () => {
      // returns-who-pays-pickup, 2026-10-11: a correct answer withheld for
      // linking the policy page rather than the section retrieval returned.
      const v = literal(`You can read the full policy details at ${PAGE}.`);
      expect(v.ok).toBe(true);
      expect(v.misses).toEqual([]);
    });

    it('accepts the returned section exactly', () => {
      expect(literal(`Details: ${SECTION}`).ok).toBe(true);
    });

    for (const [name, url] of MUST_FAIL) {
      it(`rejects ${name}`, () => {
        const v = literal(`Details: ${url}`);
        expect(v.ok).toBe(false);
        expect(v.misses[0]?.kind).toBe('url');
      });
    }

    it('rejects a fragment on a page that was returned bare', () => {
      const bare = { ok: true, results: [{ id: 'x', url: PAGE, content: 'returns policy' }] };
      const v = checkGrounding({
        reply: `See ${PAGE}#online-purchases`,
        toolResults: [bare],
        toolsCalled: ['search_knowledge'],
      });
      expect(v.ok).toBe(false);
    });
  });

  describe('the citation gate, where a link is the attribution', () => {
    it('accepts the bare page when only a section of it was returned', () => {
      const v = attributed(PAGE);
      expect(v.ok).toBe(true);
      expect(v.cited).toEqual(['fx-pickup']);
    });

    it('accepts the returned section exactly', () => {
      expect(attributed(SECTION).ok).toBe(true);
    });

    for (const [name, url] of MUST_FAIL) {
      it(`does not attribute ${name}`, () => {
        const v = attributed(url);
        expect(v.ok).toBe(false);
        expect(v.misses[0]?.reason).toBe('no_citation');
      });
    }

    it('does not attribute a fragment on a page that was returned bare', () => {
      // The rule this replaced accepted `page#anything` here.
      const v = checkCitations({
        reply: `A pickup carries a shipping fee depending on location (${PAGE}#online-purchases).`,
        sources: [{ id: 'fx-page', url: PAGE, text: 'pickup additional shipping fee location' }],
      });
      expect(v.ok).toBe(false);
    });
  });

  describe('urlGroundedBy', () => {
    it('is asymmetric in the fragment and exact everywhere else', () => {
      expect(urlGroundedBy(PAGE, SECTION)).toBe(true);
      expect(urlGroundedBy(SECTION, SECTION)).toBe(true);
      expect(urlGroundedBy(PAGE, PAGE)).toBe(true);
      expect(urlGroundedBy(SECTION, PAGE)).toBe(false);
      expect(urlGroundedBy(`${PAGE}#size-chart`, SECTION)).toBe(false);
      expect(urlGroundedBy(`${PAGE}#`, SECTION)).toBe(false);
      expect(urlGroundedBy('https://1886riyadh.com/policies', SECTION)).toBe(false);
      expect(urlGroundedBy(`${PAGE}-old`, SECTION)).toBe(false);
    });
  });
});
