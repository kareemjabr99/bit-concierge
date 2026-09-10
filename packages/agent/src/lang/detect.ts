import type { Language } from '@bitc/core';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/g;
const LATIN = /[A-Za-z]/g;

/**
 * Phase 1: script ratio only. Arabizi (Arabic in Latin letters) is detected
 * as 'en' here and handled in Phase 5, where a transliteration lexicon lands.
 * The prompt already instructs the model to answer Arabizi in Arabic script,
 * so the customer experience is right even where this label is not.
 */
export const detectLanguage = (text: string, fallback: Language = 'en'): Language => {
  const arabic = (text.match(ARABIC) ?? []).length;
  const latin = (text.match(LATIN) ?? []).length;
  if (arabic === 0 && latin === 0) return fallback;
  return arabic >= latin ? 'ar' : 'en';
};
