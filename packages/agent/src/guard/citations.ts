import { normalizeForMatch } from './normalize.ts';
import { conceptsIn, type Concept } from './concepts.ts';

/**
 * Half one, part two of the hallucination bar — attribution.
 *
 * One rule, no exemptions:
 *
 *   A sentence that asserts something in a costly category must carry a
 *   citation, and the cited source must cover every category the sentence
 *   asserts.
 *
 * Both halves matter. The citation proves the claim came from somewhere; the
 * concept check proves it came from somewhere *about that*. Citing the
 * shipping page for a returns claim resolves, and is still rejected.
 *
 * There are no sentence-level exemptions — not for questions, offers, quoted
 * tool values or embedded literals. An earlier version had five, and an
 * adversarial suite got fabricated policies past four of them by wrapping them
 * in something the gate trusted. See docs/adr/0005-grounding.md and
 * packages/agent/test/citations-adversarial.test.ts.
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

export const checkCitations = ({ reply, sources }: CitationInput): CitationVerdict => {
  const covers = new Map<string, Set<Concept>>();
  const byUrl = new Map<string, string[]>();
  for (const source of sources) {
    covers.set(source.id, conceptsIn(source.text));
    if (!source.url) continue;
    const key = trimUrl(source.url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), source.id]);
  }

  /** A link to a source's own page attributes the sentence, exactly as a marker does. */
  const linkedIds = (sentence: string): string[] =>
    (sentence.match(URL_IN_TEXT) ?? [])
      .map(trimUrl)
      .flatMap((found) =>
        [...byUrl.entries()]
          .filter(
            ([url]) => found === url || found.startsWith(`${url}#`) || found.startsWith(`${url}?`),
          )
          .flatMap(([, ids]) => ids),
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
