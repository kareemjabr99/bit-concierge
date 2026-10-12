import { normalizeForMatch } from './normalize.ts';
import { conceptsIn, type Concept } from './concepts.ts';
import { urlGroundedBy } from './url-match.ts';

/**
 * Half one, part two of the hallucination bar — attribution.
 *
 * One rule:
 *
 *   A sentence that asserts something in a costly category must carry a
 *   citation, and the cited source must cover every category the sentence
 *   asserts.
 *
 * Both halves matter. The citation proves the claim came from somewhere; the
 * concept check proves it came from somewhere *about that*. Citing the
 * shipping page for a returns claim resolves, and is still rejected.
 *
 * Two narrow exemptions, both below: a decline or hand-off that grants
 * nothing, and an offer of help that is word for word on a fixed list. None
 * for questions in general, quoted tool values or embedded literals. An
 * earlier version had five, and an adversarial suite got fabricated policies
 * past four of them by wrapping them in something the gate trusted. See
 * docs/adr/0005-grounding.md and packages/agent/test/citations-adversarial.test.ts.
 */

export const CITATION_MARKER = /\[\[c:([A-Za-z0-9_:#.-]+)\]\]/g;

/** Anything the model is allowed to cite: a retrieved chunk or a tool result. */
export interface CitableSource {
  id: string;
  /** Everything the source returned, as text. Scanned for the concepts it covers. */
  text: string;
  /** Source page, where there is one. A link to it attributes like a marker. */
  url?: string | null;
}

export interface CitationInput {
  reply: string;
  sources: CitableSource[];
  /**
   * What the customer wrote this turn. Used for one narrow purpose: a duration
   * the customer stated themselves ("it has been 8 days") is not a figure the
   * assistant produced, so echoing it inside a hand-off is not a claim. It can
   * never license a concept — only a number the customer already knew.
   */
  customerText?: string | undefined;
}

export type CitationMissReason = 'no_citation' | 'unknown_source' | 'source_mismatch';

export interface CitationMiss {
  sentence: string;
  reason: CitationMissReason;
  /** Categories the sentence asserts that no cited source covers. */
  concepts: Concept[];
  /** The id that failed to resolve, for `unknown_source`. */
  sourceId?: string;
}

export interface CitationVerdict {
  ok: boolean;
  /** The reply with markers removed — what the customer sees. */
  cleanReply: string;
  cited: string[];
  misses: CitationMiss[];
}

const SENTENCE_END = /(?<=[.!?؟۔])\s+|\n+/;

/**
 * The one exemption, and the four transcripts that forced it.
 *
 * The gate was withholding the agent's REFUSALS and HAND-OFFS — sentences that
 * make no claim a customer could act on. From the 102-case run:
 *
 *   "I cannot provide discount codes."                           [discounts]
 *   "We do not currently have an active discount code to share." [discounts]
 *   "Since it has been 8 days, I want to check with the team."   [timing]
 *   "I will connect you with the team to check how to proceed."  [returns]
 *
 * Four of that run's six false suppressions. A sentence that declines, or says
 * a human will follow up, cannot mislead anyone into acting: there is nothing
 * in it to act on.
 *
 * Narrow on purpose, and adversarially tested. It applies only when a decline
 * or hand-off marker is present AND the sentence grants nothing. A grant is
 * what makes a claim actionable — "you can", "you may", "is eligible", "we
 * offer" — and a sentence containing one is never exempt, however it is
 * wrapped.
 */
const DECLINE =
  /\b(?:i (?:cannot|can't|can not|am unable|am not able)|i (?:will|'ll|want to|would like to) (?:check|confirm|connect|pass|make sure)|let me (?:check|connect|pass)|we (?:do not|don't) (?:have|offer|provide|currently)|someone from the team|the team will|passed (?:this|it) to the team)\b|ما (?:أقدر|اقدر)|بتواصل مع الفريق|راح (?:أتحقق|اتحقق)|الفريق (?:راح|سوف)/iu;

const GRANT =
  /\b(?:you (?:can|may|are able to|are eligible|will be able|are entitled)|we (?:offer|provide|accept|allow|cover|will refund|will replace)|is eligible|are eligible|is accepted|are accepted|is free|are free|is included|are included)\b|تقدر|يمكنك|نوفر|نقبل|مجاني/iu;

/**
 * The second exemption: an offer of help, matched word for word.
 *
 * "Let me know if you have any other questions about returns." names a costly
 * category and cites nothing, so the gate withheld it — a reply suppressed for
 * its closing courtesy. It claims nothing a customer could act on.
 *
 * **A list of whole sentences, not a pattern and not a classifier.** The
 * sentence, with markers removed, lowercased, whitespace collapsed and its
 * closing punctuation dropped, must EQUAL an entry. Not start with one, not
 * contain one: every exemption this gate ever had that matched part of a
 * sentence was beaten by wrapping a claim around the part ("Returns are free —
 * let me know if you have any other questions"). Extending the list is a code
 * change with a test, which is the point.
 *
 * The entries without a topic assert no category, so the gate never flagged
 * them; they are listed so the exemption says what an offer is, not only which
 * offers happened to trip it.
 */
const OFFER_TOPICS = ['returns', 'exchanges', 'refunds', 'shipping', 'delivery', 'sizing'];
export const OFFERS_OF_HELP: readonly string[] = [
  'is there anything else i can help with',
  'is there anything else i can help you with',
  'can i help with anything else',
  'can i help you with anything else',
  'how else can i help',
  'how else can i help you',
  'let me know if there is anything else i can help with',
  'let me know if there is anything else i can help you with',
  'let me know if you have any other questions',
  ...OFFER_TOPICS.map((topic) => `let me know if you have any other questions about ${topic}`),
];

/**
 * A number, a date, a URL or a price. An offer carrying one is never exempt,
 * whatever the list says — a guard against the list, should an entry ever be
 * added that can carry a figure.
 */
const FIGURE =
  /[\d٠-٩]|https?:\/\/|www\.|[$€£]|\b(?:sar|usd|aed|riyals?)\b|ريال|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b/iu;

const asOffer = (sentence: string): string =>
  stripCitations(sentence)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?؟]+$/u, '')
    .trim();

/** True only for a sentence that is, word for word, an offer on the list. */
export const isOfferOfHelp = (
  sentence: string,
  offers: readonly string[] = OFFERS_OF_HELP,
): boolean => !FIGURE.test(stripCitations(sentence)) && offers.includes(asOffer(sentence));

const DURATION_IN =
  /(?:\d+\s*[–—-]\s*\d+|\b\d+)\s*(?:business\s|working\s)?(?:days?|hours?|weeks?)|\b\d+[–—-]day\b/giu;

const durationsIn = (text: string): Set<string> =>
  new Set((text.match(DURATION_IN) ?? []).map((d) => d.replace(/\s+/g, ' ').toLowerCase()));
const URL_IN_TEXT = /https?:\/\/[^\s<>()"'\]]+/gi;

// The prompt asks for the marker after the full stop; models also put it
// before. Fold a trailing marker back into its own sentence so the splitter
// never hands it to the next one.
const MARKER_AFTER_STOP = /([.!?؟۔])((?:\s*\[\[c:[A-Za-z0-9_:#.-]+\]\])+)/g;
const foldMarkers = (text: string): string =>
  text.replace(
    MARKER_AFTER_STOP,
    (_m, stop: string, markers: string) => ` ${markers.trim()}${stop}`,
  );

const trimUrl = (url: string): string => url.replace(/[.,;:!?)\]]+$/, '').toLowerCase();

export const stripCitations = (text: string): string =>
  text
    .replace(CITATION_MARKER, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([.!?؟،,])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();

export const checkCitations = ({
  reply,
  sources,
  customerText,
}: CitationInput): CitationVerdict => {
  const customerDurations = durationsIn(customerText ?? '');
  /** A decline or hand-off that grants nothing and invents no figure. */
  const isDecline = (sentence: string): boolean => {
    if (!DECLINE.test(sentence) || GRANT.test(sentence)) return false;
    for (const duration of durationsIn(sentence)) {
      if (!customerDurations.has(duration)) return false;
    }
    return true;
  };
  const covers = new Map<string, Set<Concept>>();
  const byUrl = new Map<string, string[]>();
  for (const source of sources) {
    covers.set(source.id, conceptsIn(source.text));
    if (!source.url) continue;
    const key = trimUrl(source.url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), source.id]);
  }

  /**
   * A link to a source's own page attributes the sentence, exactly as a marker
   * does. Which links count is url-match.ts: the bare page of a returned
   * section, or the returned section itself — never a section nobody returned.
   */
  const linkedIds = (sentence: string): string[] =>
    (sentence.match(URL_IN_TEXT) ?? [])
      .map(trimUrl)
      .flatMap((found) =>
        [...byUrl.entries()].filter(([url]) => urlGroundedBy(found, url)).flatMap(([, ids]) => ids),
      );

  const misses: CitationMiss[] = [];
  const cited = new Set<string>();

  for (const raw of foldMarkers(reply).split(SENTENCE_END)) {
    const sentence = raw.trim();
    if (!sentence) continue;

    const asserted = conceptsIn(sentence);
    const markers = [...sentence.matchAll(CITATION_MARKER)].map((m) => m[1]!);
    const ids = [...new Set([...markers, ...linkedIds(sentence)])];

    let unresolved = false;
    for (const id of ids) {
      if (covers.has(id)) cited.add(id);
      else {
        misses.push({
          sentence: stripCitations(sentence),
          reason: 'unknown_source',
          concepts: [...asserted],
          sourceId: id,
        });
        unresolved = true;
      }
    }
    if (asserted.size === 0 || unresolved) continue;
    if (ids.length === 0 && isDecline(sentence)) continue;
    if (ids.length === 0 && isOfferOfHelp(sentence)) continue;

    if (ids.length === 0) {
      misses.push({
        sentence: stripCitations(sentence),
        reason: 'no_citation',
        concepts: [...asserted],
      });
      continue;
    }

    const covered = new Set<Concept>();
    for (const id of ids) for (const concept of covers.get(id) ?? []) covered.add(concept);
    const uncovered = [...asserted].filter((concept) => !covered.has(concept));
    if (uncovered.length > 0) {
      misses.push({
        sentence: stripCitations(sentence),
        reason: 'source_mismatch',
        concepts: uncovered,
      });
    }
  }

  return { ok: misses.length === 0, cleanReply: stripCitations(reply), cited: [...cited], misses };
};

/** Builds the citable-source list from a turn's tool calls. */
export const sourcesFromToolCalls = (
  calls: { name: string; output: unknown }[],
): CitableSource[] => {
  const sources: CitableSource[] = [];
  for (const call of calls) {
    const output = call.output as {
      ok?: boolean;
      results?: { id: string; content: string; url: string | null }[];
      id?: string;
    };
    if (output?.ok !== true) continue;
    if (call.name === 'search_knowledge' && Array.isArray(output.results)) {
      for (const hit of output.results) {
        sources.push({ id: hit.id, text: normalizeForMatch(hit.content), url: hit.url });
      }
      continue;
    }
    if (typeof output.id === 'string') {
      // `note` and `next` are instructions to the model, not facts about the
      // store. Scanning them for concepts would let a tool vouch for itself.
      // `note` and `next` are instructions to the model, not facts. `id` is the
      // handle itself — "t:shipping" must not make a result vouch for shipping.
      const { note: _note, next: _next, id: _id, ...facts } = output as Record<string, unknown>;
      sources.push({ id: output.id, text: normalizeForMatch(JSON.stringify(facts)) });
    }
  }
  return sources;
};
