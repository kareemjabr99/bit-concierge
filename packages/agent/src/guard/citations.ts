import { normalizeForMatch } from './normalize.ts';

/**
 * Half one, part two — policy-claim attribution. A sentence that states a
 * policy must carry the id of the retrieved chunk it came from, and that id
 * must be one search_knowledge actually returned this turn. A claim with no
 * resolvable id is suppressed and escalated, exactly like a literal miss.
 *
 * Order facts are exempt: a policy-flavoured sentence that contains a literal
 * grounded in another tool's result ("your order #1886-2041 shipped on 8 Sep")
 * is a fact, not a policy, and needs no citation.
 * See docs/adr/0005-grounding.md.
 */

export const CITATION_MARKER = /\[\[c:([A-Za-z0-9_-]+)\]\]/g;

const POLICY_TERMS_EN =
  /\b(?:return|returns|returned|refund|refunds|exchange|exchanges|ship|ships|shipping|shipped|deliver|delivery|delivered|warranty|guarantee|size|sizes|sizing|care|wash|iron|policy|policies|free|days|hours|business days|working days|cost|fee|fees|charge|charges|duties|customs|cancel|cancellation|discount|voucher|eligible)\b/i;
const POLICY_TERMS_AR =
  /(?:إرجاع|ارجاع|استرجاع|استرداد|استبدال|تبديل|شحن|توصيل|ضمان|مقاس|مقاسات|قياس|عناية|غسيل|كوي|سياسة|مجاني|مجاناً|أيام|ايام|يوم|ساعة|ساعات|رسوم|تكلفة|جمارك|إلغاء|الغاء|خصم|كوبون)/;

export interface RetrievedChunkRef {
  chunkId: string;
  url: string | null;
}

export interface CitationInput {
  reply: string;
  /** What search_knowledge returned this turn: ids and their source pages. */
  retrieved: RetrievedChunkRef[];
  searchCalled: boolean;
  /** Results of the non-knowledge tools this turn, for the order-fact exemption. */
  otherToolResults: unknown[];
}

export type CitationMissReason = 'no_marker' | 'unknown_chunk' | 'no_retrieval';

export interface CitationMiss {
  sentence: string;
  reason: CitationMissReason;
  chunkId?: string;
}

export interface CitationVerdict {
  ok: boolean;
  /** The reply with markers removed — what the customer sees. */
  cleanReply: string;
  cited: string[];
  misses: CitationMiss[];
}

const SENTENCE_END = /(?<=[.!?؟۔])\s+|\n+/;

// The prompt asks for the marker after the full stop; models also put it
// before. Fold a trailing marker back into the sentence it belongs to so the
// splitter never hands it to the next one.
const MARKER_AFTER_STOP = /([.!?؟۔])((?:\s*\[\[c:[A-Za-z0-9_-]+\]\])+)/g;
const foldMarkers = (text: string): string =>
  text.replace(
    MARKER_AFTER_STOP,
    (_m, stop: string, markers: string) => ` ${markers.trim()}${stop}`,
  );

// An offer or a pleasantry is not a claim. "I can check that for you" states
// no policy even when it mentions one.
const CONVERSATIONAL =
  /^(?:i can|i'll|i will|i'd|let me|would you|want me|happy to|shall i|do you want|sure|of course|thanks|thank you|أقدر|خلني|خليني|تبغى|تبي|هل تريد|هل تبغى|أكيد|بكل سرور|شكرا|شكراً)(?![\p{L}\p{N}])/iu;
const GROUNDED_LITERAL =
  /https?:\/\/\S+|#\s?[A-Za-z0-9-]{3,}|\b\d{4,}\b|\b(?=[A-Z0-9-]{8,}\b)(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]+\b/g;

const URL_IN_TEXT = /https?:\/\/[^\s<>()"'\]]+/gi;
const trimUrl = (url: string): string => url.replace(/[.,;:!?)\]]+$/, '').toLowerCase();

const isQuestion = (s: string): boolean => /[?؟]\s*$/.test(s.trim());
const isPolicyClaim = (s: string): boolean => POLICY_TERMS_EN.test(s) || POLICY_TERMS_AR.test(s);
const isConversational = (s: string): boolean => CONVERSATIONAL.test(s.trim());

export const stripCitations = (text: string): string =>
  text
    .replace(CITATION_MARKER, '')
    .replace(/[ \t]+([.!?؟،,])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();

export const checkCitations = ({
  reply,
  retrieved,
  searchCalled,
  otherToolResults,
}: CitationInput): CitationVerdict => {
  const known = new Set(retrieved.map((r) => r.chunkId));
  const byUrl = new Map<string, string[]>();
  for (const r of retrieved) {
    if (!r.url) continue;
    const key = trimUrl(r.url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), r.chunkId]);
  }
  // A link to the page a chunk came from attributes the sentence as well as a
  // marker does — the model is pointing at its source.
  const linkedChunks = (sentence: string): string[] =>
    (sentence.match(URL_IN_TEXT) ?? [])
      .map(trimUrl)
      .flatMap((found) =>
        [...byUrl.entries()]
          .filter(
            ([url]) => found === url || found.startsWith(`${url}#`) || found.startsWith(`${url}?`),
          )
          .flatMap(([, ids]) => ids),
      );
  const factCorpus = normalizeForMatch(JSON.stringify(otherToolResults));
  const misses: CitationMiss[] = [];
  const cited = new Set<string>();

  for (const raw of foldMarkers(reply).split(SENTENCE_END)) {
    const sentence = raw.trim();
    if (!sentence || isQuestion(sentence)) continue;

    const markers = [...sentence.matchAll(CITATION_MARKER)].map((m) => m[1]!);
    for (const id of markers) {
      if (known.has(id)) cited.add(id);
      else
        misses.push({ sentence: stripCitations(sentence), reason: 'unknown_chunk', chunkId: id });
    }
    if (markers.length > 0) continue;
    if (!isPolicyClaim(sentence) || isConversational(sentence)) continue;

    const linked = linkedChunks(sentence);
    if (linked.length > 0) {
      for (const id of linked) cited.add(id);
      continue;
    }

    // Exempt when the sentence carries a literal another tool actually returned.
    const literals = sentence.match(GROUNDED_LITERAL) ?? [];
    const groundedElsewhere = literals.some((lit) => factCorpus.includes(normalizeForMatch(lit)));
    if (groundedElsewhere) continue;

    misses.push({ sentence, reason: searchCalled ? 'no_marker' : 'no_retrieval' });
  }

  return {
    ok: misses.length === 0,
    cleanReply: stripCitations(reply),
    cited: [...cited],
    misses,
  };
};
