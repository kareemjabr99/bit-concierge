import { describe, expect, it } from 'vitest';
import { checkCitations, conceptsIn, sourcesFromToolCalls, stripCitations } from '../src/index.ts';

/**
 * Valid sentences pass, and the citation resolves to a source about the right
 * thing. The adversarial half of this gate lives in citations-adversarial.test.ts.
 *
 * Every case marked "real transcript" is a sentence a model actually produced
 * against the fixture store; those are the cases that shaped the rule.
 */

const RETURNS = {
  id: 'fx-returns-window',
  url: 'https://dev-store.example/policies/returns',
  text: 'items can be returned within 14 days of delivery for a refund to the original payment method. items must be unworn, unwashed, with all tags attached.',
};
const EXCLUSIONS = {
  id: 'fx-returns-exclusions',
  url: 'https://dev-store.example/policies/returns',
  text: 'caps, socks and items marked final sale cannot be returned or exchanged.',
};
const SHIPPING = {
  id: 'fx-shipping-ksa',
  url: 'https://dev-store.example/policies/shipping',
  text: 'orders within saudi arabia ship with smsa express. shipping is free on orders over 300 sar; otherwise it is 25 sar. published delivery range is 2 4 business days.',
};
const SOURCES = [RETURNS, EXCLUSIONS, SHIPPING];

const check = (reply: string, sources = SOURCES) => checkCitations({ reply, sources });

describe('citation gate', () => {
  it('accepts a cited policy claim and strips the marker', () => {
    const v = check('You can return within 14 days of delivery. [[c:fx-returns-window]]');
    expect(v.ok).toBe(true);
    expect(v.cited).toEqual(['fx-returns-window']);
    expect(v.cleanReply).toBe('You can return within 14 days of delivery.');
  });

  it('accepts the marker on either side of the full stop', () => {
    for (const reply of [
      'Caps cannot be returned. [[c:fx-returns-exclusions]]',
      'Caps cannot be returned [[c:fx-returns-exclusions]].',
      'Caps cannot be returned.[[c:fx-returns-exclusions]]',
    ]) {
      const v = check(reply);
      expect(v.ok, reply).toBe(true);
      expect(v.cleanReply).toBe('Caps cannot be returned.');
    }
  });

  it('reads a link to the source page as attribution — real transcript', () => {
    // "You can read the full policy details on our returns page (…)" arrived
    // after three correctly cited sentences and was withheld for lacking a marker.
    const v = check(
      'Caps cannot be returned. [[c:fx-returns-exclusions]] Full returns details are on our returns page (https://dev-store.example/policies/returns).',
    );
    expect(v.ok).toBe(true);
  });

  it('needs no citation for a sentence that asserts nothing costly — real transcript', () => {
    // "It has been shipped via SMSA Express and is currently in transit."
    // reports an event; the literal gate checks the carrier against the tool.
    for (const reply of [
      'It has been dispatched with SMSA Express and is currently in transit.',
      'The Sadu Hoodie in size M is currently out of stock.',
      'Happy to help. Which one did you order?',
    ]) {
      expect(check(reply).ok, reply).toBe(true);
    }
  });

  it('withholds a policy claim with no citation', () => {
    const v = check('You can return within 30 days.');
    expect(v.ok).toBe(false);
    expect(v.misses[0]).toMatchObject({ reason: 'no_citation' });
    expect(v.misses[0]?.concepts).toContain('returns');
  });

  it('withholds a marker that resolves to nothing', () => {
    const v = check('Caps cannot be returned. [[c:invented]]');
    expect(v.ok).toBe(false);
    expect(v.misses[0]).toMatchObject({ reason: 'unknown_source', sourceId: 'invented' });
  });

  it('withholds a claim cited to a source about something else', () => {
    const v = check('You can return within 14 days. [[c:fx-shipping-ksa]]');
    expect(v.ok).toBe(false);
    expect(v.misses[0]).toMatchObject({ reason: 'source_mismatch' });
    expect(v.misses[0]?.concepts).toContain('returns');
  });

  it('always requires a source for a duration or a timing word', () => {
    for (const reply of [
      'It should arrive within 2–4 days.',
      'The hoodie will be back in stock soon.',
      'راح يرجع المخزون قريباً.',
      'We will send it tomorrow.',
    ]) {
      expect(check(reply).ok, reply).toBe(false);
    }
    expect(check('Delivery inside Saudi is 2–4 business days. [[c:fx-shipping-ksa]]').ok).toBe(
      true,
    );
  });

  it('handles Arabic policy sentences and the Arabic question mark', () => {
    const ar = {
      id: 'fx-returns-window-ar',
      url: 'https://dev-store.example/policies/returns',
      text: 'يمكن إرجاع المنتجات خلال 14 يوماً من تاريخ الاستلام واسترداد المبلغ.',
    };
    const v = checkCitations({
      reply:
        'تقدر ترجع المنتج خلال 14 يوم من الاستلام. [[c:fx-returns-window-ar]] تبغى أساعدك بشي ثاني؟',
      sources: [ar],
    });
    expect(v.ok).toBe(true);
    expect(stripCitations(v.cleanReply)).not.toContain('[[');
  });

  it('lets a tool result support a fact about this order — real transcript', () => {
    // "…وهو قيد التجهيز للشحن إلى جدة" mentions shipping, so it needs a source;
    // the order lookup is one.
    const order = {
      id: 't:order',
      text: 'number 1886 2042 ship to jeddah sa fulfillment status unfulfilled',
    };
    const reply = 'الطلب مدفوع وهو قيد التجهيز للشحن إلى جدة. [[c:t:order]]';
    expect(checkCitations({ reply, sources: [order] }).ok).toBe(true);
    expect(checkCitations({ reply, sources: [] }).ok).toBe(false);
  });
});

describe('concepts', () => {
  it('reads a rule but not an event report', () => {
    expect(conceptsIn('we ship to the GCC').has('shipping')).toBe(true);
    expect(conceptsIn('your order shipped').has('shipping')).toBe(false);
    expect(conceptsIn('size M is out of stock').has('sizing')).toBe(false);
    expect(conceptsIn('the tee runs large').has('sizing')).toBe(true);
  });

  it('reads Arabic', () => {
    expect(conceptsIn('سياسة الإرجاع').has('returns')).toBe(true);
    expect(conceptsIn('الشحن مجاني').has('fees')).toBe(true);
    expect(conceptsIn('خلال 14 يوم').has('timing')).toBe(true);
  });
});

describe('sourcesFromToolCalls', () => {
  it('expands knowledge hits and takes an id from every other factual result', () => {
    const sources = sourcesFromToolCalls([
      {
        name: 'search_knowledge',
        output: {
          ok: true,
          results: [{ id: 'fx-a', content: 'returns within 14 days', url: 'u' }],
        },
      },
      {
        name: 'get_shipping_estimate',
        output: { ok: true, id: 't:shipping', cost: '45 SAR', note: 'do not promise' },
      },
      {
        name: 'lookup_order',
        output: { ok: false, error: { code: 'not_verified', message: 'x' } },
      },
      { name: 'escalate_to_human', output: { ok: true, escalation_id: 'e1' } },
    ]);
    expect(sources.map((s) => s.id)).toEqual(['fx-a', 't:shipping']);
    // Instruction fields must not let a tool vouch for itself.
    expect(sources[1]?.text).not.toContain('promise');
  });
});
