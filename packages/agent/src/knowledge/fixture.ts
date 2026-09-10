import type { Language } from '@bitc/core';
import type { KnowledgeHit, KnowledgeQuery, KnowledgeSearcher } from './types.ts';

interface FixtureChunk {
  id: string;
  lang: Language;
  title: string;
  url: string;
  headingPath: string[];
  content: string;
  keywords: string[];
}

const SITE = 'https://dev-store.example';

/**
 * A synthetic policy corpus in the shape Phase 2's chunker will produce.
 * Content is invented for a fictional store. Ids are stable so tests and
 * transcripts can name them.
 */
export const FIXTURE_CHUNKS: FixtureChunk[] = [
  {
    id: 'fx-returns-window',
    lang: 'en',
    title: 'Returns & Exchanges',
    url: `${SITE}/policies/returns`,
    headingPath: ['Returns & Exchanges', 'Window'],
    content:
      'Items can be returned within 14 days of delivery for a refund to the original payment method. Items must be unworn, unwashed, with all tags attached and in the original packaging.',
    keywords: ['return', 'returns', 'refund', 'days', 'window', 'unworn', 'tags'],
  },
  {
    id: 'fx-returns-exclusions',
    lang: 'en',
    title: 'Returns & Exchanges',
    url: `${SITE}/policies/returns`,
    headingPath: ['Returns & Exchanges', 'Exclusions'],
    content: 'Caps, socks and items marked final sale cannot be returned or exchanged.',
    keywords: ['return', 'cap', 'caps', 'socks', 'final sale', 'exclusion', 'exchange'],
  },
  {
    id: 'fx-exchanges',
    lang: 'en',
    title: 'Returns & Exchanges',
    url: `${SITE}/policies/returns`,
    headingPath: ['Returns & Exchanges', 'Exchanges'],
    content:
      'Size exchanges are free within Saudi Arabia. Request an exchange from your order page and a courier will collect the item; the replacement ships once the original is received.',
    keywords: ['exchange', 'exchanges', 'size', 'swap', 'free', 'courier', 'collect'],
  },
  {
    id: 'fx-shipping-ksa',
    lang: 'en',
    title: 'Shipping',
    url: `${SITE}/policies/shipping`,
    headingPath: ['Shipping', 'Saudi Arabia'],
    content:
      'Orders within Saudi Arabia ship with SMSA Express. Shipping is free on orders over 300 SAR; otherwise it is 25 SAR. Published delivery range is 2–4 business days from dispatch.',
    keywords: [
      'shipping',
      'ship',
      'delivery',
      'saudi',
      'ksa',
      'riyadh',
      'jeddah',
      'smsa',
      'free',
      'cost',
    ],
  },
  {
    id: 'fx-shipping-gcc',
    lang: 'en',
    title: 'Shipping',
    url: `${SITE}/policies/shipping`,
    headingPath: ['Shipping', 'GCC'],
    content:
      'We ship to the UAE, Kuwait, Bahrain, Qatar and Oman with Aramex. Duties are included in the price at checkout. We do not currently ship outside the GCC.',
    keywords: [
      'shipping',
      'ship',
      'gcc',
      'uae',
      'dubai',
      'kuwait',
      'bahrain',
      'qatar',
      'oman',
      'international',
      'duties',
      'egypt',
      'outside',
    ],
  },
  {
    id: 'fx-sizing-tee',
    lang: 'en',
    title: 'Size Guide',
    url: `${SITE}/pages/size-guide`,
    headingPath: ['Size Guide', 'Tees'],
    content:
      'The Riyadh Oversized Tee is cut one size large. If you are between sizes or want a regular fit, take one size down. Chest (flat): S 58 cm, M 61 cm, L 64 cm, XL 67 cm.',
    keywords: [
      'size',
      'sizing',
      'fit',
      'tee',
      'oversized',
      'chest',
      'cm',
      'large',
      'small',
      'medium',
    ],
  },
  {
    id: 'fx-care',
    lang: 'en',
    title: 'Care',
    url: `${SITE}/pages/care`,
    headingPath: ['Care'],
    content:
      'Wash cold, inside out, with similar colours. Do not tumble dry. Iron on low, avoiding any print or embroidery. Garment-dyed pieces may soften and fade slightly with washing; this is intended.',
    keywords: ['care', 'wash', 'washing', 'iron', 'dry', 'fade', 'shrink', 'embroidery', 'print'],
  },
  {
    id: 'fx-returns-window-ar',
    lang: 'ar',
    title: 'الإرجاع والاستبدال',
    url: `${SITE}/policies/returns`,
    headingPath: ['الإرجاع والاستبدال', 'المدة'],
    content:
      'يمكن إرجاع المنتجات خلال 14 يوماً من تاريخ الاستلام واسترداد المبلغ لنفس وسيلة الدفع. يجب أن تكون القطعة غير ملبوسة وغير مغسولة مع جميع البطاقات وفي التغليف الأصلي.',
    keywords: ['إرجاع', 'ارجاع', 'استرجاع', 'استرداد', 'يوم', 'أيام', 'مدة'],
  },
  {
    id: 'fx-shipping-ksa-ar',
    lang: 'ar',
    title: 'الشحن',
    url: `${SITE}/policies/shipping`,
    headingPath: ['الشحن', 'السعودية'],
    content:
      'الشحن داخل السعودية عبر سمسا. الشحن مجاني للطلبات فوق 300 ريال، وغير ذلك 25 ريال. مدة التوصيل المعلنة من 2 إلى 4 أيام عمل من تاريخ الشحن.',
    keywords: ['شحن', 'توصيل', 'السعودية', 'الرياض', 'جدة', 'مجاني', 'تكلفة', 'رسوم'],
  },
];

// Function words carry no signal and would drag the score of a perfectly good
// question below the threshold. A real retriever handles this with IDF; the
// fixture handles it with a list.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'am',
  'was',
  'were',
  'be',
  'can',
  'could',
  'i',
  'my',
  'me',
  'you',
  'your',
  'we',
  'our',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'to',
  'of',
  'do',
  'does',
  'did',
  'for',
  'in',
  'on',
  'at',
  'and',
  'or',
  'what',
  'how',
  'when',
  'where',
  'which',
  'who',
  'why',
  'have',
  'has',
  'had',
  'with',
  'about',
  'from',
  'there',
  'any',
  'some',
  'please',
  'pls',
  'hi',
  'hello',
  'if',
  'would',
  'like',
  'هل',
  'في',
  'من',
  'على',
  'عن',
  'ما',
  'هذا',
  'هذه',
  'لو',
  'انا',
  'أنا',
  'لي',
  'عندي',
  'ابغى',
  'أبغى',
  'ابي',
  'أبي',
  'ودي',
  'ممكن',
  'كيف',
  'متى',
  'وين',
  'فين',
  'شو',
  'ايش',
  'إيش',
  'هو',
  'هي',
]);

// "items" and "item" are the same word to a customer.
const stem = (t: string): string => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);

/**
 * Keyword overlap over the fixture corpus. Score is the fraction of query
 * tokens that hit a chunk's keywords or content, so it is 0–1 and the tenant
 * threshold means something. Language filter with fallback to the other, as
 * the retrieval spec requires.
 */
export class FixtureKnowledge implements KnowledgeSearcher {
  constructor(private readonly chunks: FixtureChunk[] = FIXTURE_CHUNKS) {}

  async search({ query, lang, topK, minScore }: KnowledgeQuery): Promise<KnowledgeHit[]> {
    const terms = tokens(query);
    if (terms.length === 0) return [];

    const score = (chunk: FixtureChunk): number => {
      const haystack = new Set([
        ...chunk.keywords.map((k) => k.toLowerCase()),
        ...tokens(chunk.content),
      ]);
      const hits = terms.filter((t) => haystack.has(t)).length;
      return hits / terms.length;
    };

    const rank = (candidates: FixtureChunk[]): KnowledgeHit[] =>
      candidates
        .map((chunk) => ({ chunk, s: score(chunk) }))
        .filter(({ s }) => s >= minScore)
        .sort((a, b) => b.s - a.s)
        .slice(0, topK)
        .map(({ chunk, s }) => ({
          chunkId: chunk.id,
          content: chunk.content,
          title: chunk.title,
          url: chunk.url,
          headingPath: chunk.headingPath,
          score: Number(s.toFixed(3)),
        }));

    const primary = rank(this.chunks.filter((c) => c.lang === lang));
    if (primary.length >= Math.min(2, topK)) return primary;
    const fallback = rank(this.chunks.filter((c) => c.lang !== lang));
    return [...primary, ...fallback].slice(0, topK);
  }
}
