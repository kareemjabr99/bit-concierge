/** Shared text normalisation for the grounding gates. */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export const asciiDigits = (text: string): string =>
  text.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : EASTERN_ARABIC_INDIC.indexOf(d));
  });

/** Currency spellings a model might use for the same amount. */
const CURRENCY = /(?:\bSAR\b|\bS\.R\.?|ر\.س\.?|ريال\s*سعودي|ريال|﷼|\bريالات\b)/giu;

/**
 * Lowercase, ASCII digits, one currency token, no thousands separators, no
 * order-number hash, collapsed whitespace. Applied to both the reply and the
 * tool-result corpus so that "SAR 1,189" and "١١٨٩ ريال" compare equal.
 */
export const normalizeForMatch = (text: string): string =>
  asciiDigits(text.normalize('NFKC'))
    .replace(CURRENCY, ' sar ')
    .replace(/(\d)[,٬](?=\d{3}\b)/g, '$1')
    .replace(/#/g, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
