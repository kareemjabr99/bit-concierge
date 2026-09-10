import { normalizeForMatch } from './normalize.ts';

/**
 * Half one of the hallucination bar — the literal check. Deterministic, no
 * model. Every fact class that can hurt us is extracted from the reply and
 * must appear, normalised, somewhere in this turn's tool results.
 * See docs/adr/0005-grounding.md.
 */

export type GroundingMissKind =
  'order_number' | 'tracking' | 'url' | 'price' | 'date' | 'long_number' | 'stock_claim';

export interface GroundingMiss {
  kind: GroundingMissKind;
  value: string;
}

export interface GroundingVerdict {
  ok: boolean;
  misses: GroundingMiss[];
  /** Literals that were checked and found. Useful in transcripts. */
  matched: number;
}

export interface GroundingInput {
  reply: string;
  /** Raw results of every tool call this turn, in order. */
  toolResults: unknown[];
  /** Names of tools called this turn. */
  toolsCalled: string[];
}

const URL = /https?:\/\/[^\s<>()"'\]]+/gi;
const ORDER_REF = /#\s?[A-Za-z0-9][A-Za-z0-9-]{2,}/g;
// Carrier references: 8+ chars, mixed letters and digits, no spaces.
const TRACKING = /\b(?=[A-Z0-9-]{8,}\b)(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]+\b/g;
const PRICE =
  /(?:\d[\d,.]*\s*(?:sar|usd|aed|kwd|bhd|qar|omr|egp|\$|€|£))|(?:(?:sar|usd|aed|kwd|bhd|qar|omr|egp|\$|€|£)\s*\d[\d,.]*)/gi;
const MONTH =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)';
const DATE = new RegExp(
  `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\s+(?:${MONTH})\\b|\\b(?:${MONTH})\\s+\\d{1,2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`,
  'giu',
);
const LONG_NUMBER = /\b\d{4,}\b/g;
const STOCK_CLAIM =
  /\b(?:in stock|out of stock|sold out|back in stock|available|unavailable|restocked|last (?:one|piece)|only \d+ left)\b|متوفر|غير متوفر|نفذ|نفدت|خلص|متاح|غير متاح/giu;
const STOCK_TOOLS = new Set(['check_availability', 'search_products']);

const uniq = (values: string[]): string[] => [...new Set(values)];

const trimUrl = (url: string): string => url.replace(/[.,;:!?)\]]+$/, '');

export const checkGrounding = ({
  reply,
  toolResults,
  toolsCalled,
}: GroundingInput): GroundingVerdict => {
  const corpus = normalizeForMatch(JSON.stringify(toolResults));
  const normalizedReply = normalizeForMatch(reply);
  const misses: GroundingMiss[] = [];
  let matched = 0;

  const require = (kind: GroundingMissKind, raw: string, needle = normalizeForMatch(raw)): void => {
    if (!needle) return;
    if (corpus.includes(needle)) matched += 1;
    else misses.push({ kind, value: raw });
  };

  for (const url of uniq((reply.match(URL) ?? []).map(trimUrl)))
    require('url', url, url.toLowerCase());
  for (const ref of uniq(reply.match(ORDER_REF) ?? [])) require('order_number', ref);
  for (const track of uniq(reply.match(TRACKING) ?? [])) require('tracking', track);
  for (const price of uniq(normalizedReply.match(PRICE) ?? [])) {
    // Compare the digits, not the phrasing around them.
    const digits = price.replace(/[^\d.]/g, '').replace(/\.00$/, '');
    require('price', price, digits);
  }
  for (const date of uniq(reply.match(DATE) ?? [])) require('date', date);
  for (const n of uniq(normalizedReply.match(LONG_NUMBER) ?? [])) require('long_number', n);

  const stockClaims = uniq(reply.match(STOCK_CLAIM) ?? []);
  if (stockClaims.length > 0 && !toolsCalled.some((t) => STOCK_TOOLS.has(t))) {
    for (const claim of stockClaims) misses.push({ kind: 'stock_claim', value: claim });
  }

  return { ok: misses.length === 0, misses, matched };
};
