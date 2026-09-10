import { describe, expect, it } from 'vitest';
import { checkCitations } from '../src/index.ts';

/**
 * Adversarial suite for the citation gate.
 *
 * The other suite proves valid sentences pass. This one proves fabricated
 * sentences do not — specifically, fabricated sentences built to exploit each
 * exemption. An exemption that cannot be attacked here is an exemption we can
 * defend; one that can is a hole, and the finding is the point.
 *
 * Every case below states a policy that appears in NO retrieved chunk. Each is
 * wrapped in something the gate has a reason to trust: a real carrier name, a
 * real order number, a real source link, a question, an offer.
 *
 * Ranked by what it would cost the merchant if it reached a customer.
 */

/**
 * Everything the model legitimately has this turn: two retrieved chunks, an
 * order lookup and a shipping estimate. The attacks below all cite nothing, or
 * cite one of these for a claim it does not support.
 */
const SOURCES = [
  {
    id: 'fx-returns-window',
    url: 'https://dev-store.example/policies/returns',
    text: 'items can be returned within 14 days of delivery for a refund to the original payment method.',
  },
  {
    id: 'fx-shipping-ksa',
    url: 'https://dev-store.example/policies/shipping',
    text: 'orders within saudi arabia ship with smsa express. shipping is free on orders over 300 sar. published delivery range is 2 4 business days.',
  },
  {
    id: 't:order',
    text: 'number 1886 2041 ship to jeddah sa carrier smsa express status in transit tracking number smsa1886204100 items najd cargo pant variant 32',
  },
  {
    id: 't:shipping',
    text: 'destination united arab emirates carrier aramex published range 3 6 business days cost 45 sar',
  },
];

const attack = (reply: string) => checkCitations({ reply, sources: SOURCES });

describe('citation gate under attack', () => {
  describe('a sentence quoting a value another tool returned', () => {
    it('rejects a fabricated refund policy riding on a real carrier name', () => {
      const v = attack(
        'It went out with SMSA Express, and you can return it within 30 days for a full refund.',
      );
      expect(v.ok).toBe(false);
    });

    it('rejects a fabricated fee waiver riding on a real destination', () => {
      const v = attack('Shipping to the United Arab Emirates is free on every order.');
      expect(v.ok).toBe(false);
    });

    it('rejects a fabricated policy riding on an adjacent word pair of a product title', () => {
      // "Najd Cargo Pant" contributes the pair "cargo pant".
      const v = attack('Cargo pants can be exchanged for any reason within 60 days.');
      expect(v.ok).toBe(false);
    });

    it('rejects a fabricated policy riding on a generic pair from a published range', () => {
      // "3–6 business days" contributes the pair "business days".
      const v = attack('Refunds are issued on business days only and carry no restocking fee.');
      expect(v.ok).toBe(false);
    });
  });

  describe('a sentence carrying a literal from another tool', () => {
    it('rejects a fabricated return window riding on a real order number', () => {
      const v = attack(
        'Your order #1886-2041 qualifies for our 30-day no-questions return window.',
      );
      expect(v.ok).toBe(false);
    });

    it('rejects a fabricated duty claim riding on a real tracking number', () => {
      const v = attack(
        'Tracking SMSA1886204100 shows it cleared customs — duties are always on us.',
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('a link to a retrieved page', () => {
    it('rejects a fabricated policy linked to an unrelated retrieved page', () => {
      const v = attack(
        'Returns are accepted for 60 days, no receipt needed — https://dev-store.example/policies/shipping',
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('questions and offers', () => {
    it('rejects a policy stated as a rhetorical question', () => {
      const v = attack('Did you know returns are completely free for a full 60 days?');
      expect(v.ok).toBe(false);
    });

    it('rejects a policy stated behind a conversational opener', () => {
      const v = attack('I can confirm that refunds are issued within 90 days of purchase.');
      expect(v.ok).toBe(false);
    });
  });

  describe('baseline: attribution the gate should still accept', () => {
    it('accepts a cited policy claim', () => {
      const v = attack('You can return within 14 days of delivery. [[c:fx-returns-window]]');
      expect(v.ok).toBe(true);
    });

    it('accepts an order-status report that states no policy', () => {
      const v = attack('It has been dispatched with SMSA Express and is currently in transit.');
      expect(v.ok).toBe(true);
    });

    it('accepts a shipping answer cited to the shipping estimate that produced it', () => {
      const v = attack('Shipping to the United Arab Emirates is 45 SAR. [[c:t:shipping]]');
      expect(v.ok).toBe(true);
    });
  });
});
