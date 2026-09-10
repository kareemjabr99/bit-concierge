/**
 * What a sentence is *about*, in the categories where a wrong claim costs a
 * customer money or a merchant a refund. Used by the citation gate on both
 * sides: the concepts a sentence asserts, and the concepts a cited source
 * actually covers. See docs/adr/0005-grounding.md.
 *
 * Deliberately narrow. Every term here belongs to a claim a customer could act
 * on. Words that merely *describe* an order — "shipped", "dispatched",
 * "delivered", a bare "size" naming a variant — are absent: they report an
 * event the literal gate already checks against tool results, and including
 * them withheld four correct answers on the first real-model run.
 */

export const CONCEPTS = [
  'returns',
  'shipping',
  'fees',
  'warranty',
  'cancellation',
  'discounts',
  'sizing',
  'care',
  'timing',
] as const;

export type Concept = (typeof CONCEPTS)[number];

/**
 * One pattern per concept, covering English and Arabic together. Arabic is not
 * stemmed here — the alternations spell out the forms a customer or a model
 * actually writes.
 */
const PATTERNS: Record<Concept, RegExp> = {
  returns:
    /\b(?:returns?|returned|returnable|returning|refunds?|refunded|refundable|exchanges?|exchanged|exchangeable|restock\w*)\b|إرجاع|ارجاع|استرجاع|ترجيع|استرداد|استبدال|تبديل|نرجع|ترجع|يرجع/iu,
  // Present and gerund forms state a rule. "shipped"/"dispatched"/"delivered"
  // report an event and are excluded on purpose. Arabic cannot be cut that way,
  // so Arabic order-status sentences do need a source — tool results are citable.
  shipping:
    /\b(?:ships?|shipping|delivers?|delivery|deliveries|courier|carrier|freight)\b|شحن|الشحن|توصيل|التوصيل|ناقل/iu,
  fees: /\b(?:fees?|charges?|charged|chargeable|costs?|prices?|pricing|free|duty|duties|customs|tax|taxes|vat|surcharge)\b|رسوم|تكلفة|تكاليف|سعر|أسعار|مجان|مجاني|مجانا|مجاناً|جمارك|ضريبة|ضرائب/iu,
  warranty: /\b(?:warrant\w*|guarantee\w*)\b|ضمان|الضمان/iu,
  cancellation: /\bcancel\w*\b|إلغاء|الغاء|نلغي|يلغى/iu,
  discounts: /\b(?:discount\w*|voucher\w*|coupon\w*|promo\w*)\b|خصم|خصومات|كوبون|قسيمة/iu,
  // A bare "size" names a variant. Only guidance counts.
  sizing:
    /\b(?:size guide|size chart|sizing|runs (?:large|small|big|true)|true to size|fits? (?:large|small|true))\b|دليل المقاسات|جدول المقاسات|جدول القياسات/iu,
  care: /\b(?:wash|washes|washing|launder\w*|tumble dry|dry clean|iron|ironing|bleach)\b|غسيل|الغسيل|كوي|تنظيف جاف|مبيض/iu,
  // Any commitment about when. The prompt forbids making one; the gate makes
  // sure that if one is made it came from somewhere.
  timing:
    /(?:\d+\s*[–—-]\s*\d+|\b\d+)\s*(?:business\s|working\s)?(?:days?|hours?|weeks?)\b|\b\d+[–—-]day\b|\bwithin\s+\d+\b|\b(?:business|working)\s+days?\b|\b(?:soon|shortly|asap|tomorrow|tonight|overnight|this week|next week)\b|(?:\d+\s*(?:إلى|-|–)\s*)?\d+\s*(?:أيام|يوم|ساعات|ساعة|أسابيع|أسبوع)|خلال\s+\d+|أيام\s*العمل|قريباً|قريبا|بكرة|بكره/iu,
};

// A citation marker and a URL are plumbing, not assertions. Reading concepts
// out of them let a sentence's own citation vouch for its topic:
// "[[c:fx-returns-exclusions]]" contains the word "returns".
const PLUMBING = /\[\[c:[A-Za-z0-9_:#.-]+\]\]|https?:\/\/[^\s<>()"'\]]+/gi;

/** Which of these a piece of text asserts or covers. */
export const conceptsIn = (text: string): Set<Concept> => {
  const prose = text.replace(PLUMBING, ' ');
  const found = new Set<Concept>();
  for (const concept of CONCEPTS) {
    // Global-flag state is not shared: each pattern is used with `test` only.
    if (PATTERNS[concept].test(prose)) found.add(concept);
  }
  return found;
};
