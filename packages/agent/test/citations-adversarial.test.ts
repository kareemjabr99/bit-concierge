import { describe, expect, it } from 'vitest';
import { OFFERS_OF_HELP, checkCitations, isOfferOfHelp } from '../src/index.ts';

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

  describe('the decline exemption', () => {
    // The only exemption in the gate. Each attack wraps an actionable claim in
    // a refusal or hand-off, which is exactly how the previous five exemptions
    // were defeated.
    it('rejects a grant smuggled into a refusal', () => {
      expect(
        attack('I cannot process it myself, but you are eligible for a 90 day return.').ok,
      ).toBe(false);
      expect(attack('We do not currently have that, but returns are free for 60 days.').ok).toBe(
        false,
      );
      expect(attack('Let me check — meanwhile, you can return sale items within 30 days.').ok).toBe(
        false,
      );
    });

    it('rejects a figure the customer never mentioned', () => {
      const v = checkCitations({
        reply: 'Since it has been 90 days, I want to check with the team.',
        sources: [],
        customerText: 'I received my order 8 days ago',
      });
      expect(v.ok).toBe(false);
    });

    it('accepts a figure the customer supplied themselves', () => {
      const v = checkCitations({
        reply: 'Since it has been 8 days, I want to check with the team on this for you.',
        sources: [],
        customerText: 'I received my order 8 days ago, can I still return it?',
      });
      expect(v.ok).toBe(true);
    });

    it('accepts a plain refusal or hand-off — the real transcripts', () => {
      for (const reply of [
        'I cannot provide discount codes.',
        'We do not currently have an active discount code available to share.',
        'I want to make sure we handle this correctly, so I will connect you with the team.',
      ]) {
        expect(attack(reply).ok, reply).toBe(true);
      }
    });
  });

  describe('the offer-of-help exemption', () => {
    // The second exemption: whole sentences on a fixed list, nothing partial.
    // Each attack below is an offer with a claim or a figure attached.
    it('accepts an offer on the list that names a category', () => {
      for (const reply of [
        'Let me know if you have any other questions about returns.',
        'let me know if you have any other questions about SIZING!',
        'Let me know if you have any other questions about   shipping?',
        'Let me know if you have any other questions\u00a0about delivery.',
      ]) {
        const v = attack(reply);
        expect(v.ok, reply).toBe(true);
      }
    });

    it('accepts the offers that name nothing, as it always did', () => {
      for (const reply of ['Is there anything else I can help with?', 'How else can I help you?']) {
        expect(attack(reply).ok, reply).toBe(true);
      }
    });

    it('rejects a commitment phrased as an offer', () => {
      expect(attack('I can refund you within 3 days.').ok).toBe(false);
      expect(attack('We can ship it tomorrow.').ok).toBe(false);
      expect(attack('I can refund you.').ok).toBe(false);
      expect(attack('We can ship it to you free of charge.').ok).toBe(false);
    });

    it('rejects an offer carrying a number, a date, a URL or a price', () => {
      for (const reply of [
        'Let me know if you have any other questions about returns within 7 days.',
        'Let me know if you have any other questions about returns, which take 14 days.',
        'Let me know if you have any other questions about delivery before 14 October.',
        'Let me know if you have any other questions about delivery, arriving tomorrow.',
        'Let me know if you have any other questions about returns: https://dev-store.example/pages/free-returns',
        'Let me know if you have any other questions about shipping, which is 25 SAR.',
        'Let me know if you have any other questions about shipping at $10.',
      ]) {
        expect(attack(reply).ok, reply).toBe(false);
      }
    });

    it('rejects a claim wrapped around an offer on the list', () => {
      for (const reply of [
        'Returns are free — let me know if you have any other questions about returns.',
        'Let me know if you have any other questions about returns, which are always free.',
        'Exchanges cost nothing, so let me know if you have any other questions about exchanges.',
        'Is there anything else I can help with, since refunds are automatic?',
      ]) {
        expect(attack(reply).ok, reply).toBe(false);
      }
    });

    it('holds the figure guard even against an entry that carries one', () => {
      // The list cannot license a figure: if someone adds an entry that does,
      // the guard still refuses it.
      for (const bad of [
        'let me know if you have any other questions about returns within 7 days',
        'let me know if you have any other questions about delivery on 14 october',
        'let me know if you have any other questions about delivery on monday',
        'let me know if you have any other questions about delivery in october',
        'let me know if you have any other questions about delivery, arriving tomorrow',
        'let me know if you have any other questions about https://dev-store.example/x',
        'let me know if you have any other questions about the sar fee',
      ]) {
        expect(isOfferOfHelp(`${bad}.`, [...OFFERS_OF_HELP, bad]), bad).toBe(false);
      }
      expect(isOfferOfHelp('Let me know if you have any other questions about returns.')).toBe(
        true,
      );
    });

    it('still withholds an offer that is not on the list — real transcript', () => {
      // sizing-tee-chest, 2026-10-11. An offer, but one naming a product and
      // promising to check it; the list is literal, and this is not on it.
      const v = attack(
        'If you are looking at a particular t-shirt, let me know and I can check the exact sizing for it.',
      );
      expect(v.ok).toBe(false);
      expect(v.misses[0]?.reason).toBe('no_citation');
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
