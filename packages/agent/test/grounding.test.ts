import { describe, expect, it } from 'vitest';
import { checkGrounding } from '../src/index.ts';

const orderResult = {
  ok: true,
  order: {
    number: '#1886-2041',
    total: '189.00 SAR',
    placed_at: '2026-09-06T14:12:00Z',
    status_page_url: 'https://dev-store.example/orders/status/2041',
    shipments: [
      {
        tracking_number: 'SMSA1886204100',
        tracking_url: 'https://track.example/SMSA1886204100',
        status: 'in_transit',
      },
    ],
  },
};

describe('grounding gate — literals', () => {
  it('passes a reply whose facts all appear in tool results', () => {
    const v = checkGrounding({
      reply:
        'Order #1886-2041 shipped with SMSA. Track it here: https://track.example/SMSA1886204100 — total was 189 SAR.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(true);
    expect(v.matched).toBeGreaterThanOrEqual(3);
  });

  it('catches an invented order number', () => {
    const v = checkGrounding({
      reply: 'Your order #1886-9999 is on its way.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(false);
    expect(v.misses.map((m) => m.kind)).toContain('order_number');
  });

  it('catches an invented tracking number', () => {
    const v = checkGrounding({
      reply: 'Tracking: SMSA0000000001',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(false);
    expect(v.misses.some((m) => m.kind === 'tracking' || m.kind === 'long_number')).toBe(true);
  });

  it('catches a URL the tools never returned', () => {
    const v = checkGrounding({
      reply: 'Request a refund at https://dev-store.example/refund-now',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]?.kind).toBe('url');
  });

  it('catches an invented price and accepts a reformatted real one', () => {
    const bad = checkGrounding({
      reply: 'That comes to 249 SAR.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(bad.ok).toBe(false);
    expect(bad.misses[0]?.kind).toBe('price');

    const good = checkGrounding({
      reply: 'That was SAR 189.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(good.ok).toBe(true);
  });

  it('catches a promised date', () => {
    const v = checkGrounding({
      reply: 'It will arrive on 12 September.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]?.kind).toBe('date');
  });

  it('accepts Arabic-Indic digits for a real number', () => {
    const v = checkGrounding({
      reply: 'رقم طلبك ١٨٨٦-٢٠٤١ في الطريق.',
      toolResults: [orderResult],
      toolsCalled: ['lookup_order'],
    });
    expect(v.ok).toBe(true);
  });

  it('flags a stock claim made without a stock tool', () => {
    const v = checkGrounding({
      reply: 'The hoodie is sold out at the moment.',
      toolResults: [],
      toolsCalled: ['search_knowledge'],
    });
    expect(v.ok).toBe(false);
    expect(v.misses[0]?.kind).toBe('stock_claim');

    const ok = checkGrounding({
      reply: 'The hoodie is sold out at the moment.',
      toolResults: [{ ok: true, variants: [{ available: false }] }],
      toolsCalled: ['check_availability'],
    });
    expect(ok.ok).toBe(true);
  });

  describe('false positives found by the first eval run', () => {
    // All three withheld correct answers. None was a model fabrication.
    const knowledge = {
      ok: true,
      results: [
        {
          id: 'fx-1',
          url: 'https://1886riyadh.com/policies/refund-policy#returns-exchanges-policy',
          content: 'You are eligible for returns within 7 days.',
        },
      ],
    };

    it('accepts a source URL with its anchor', () => {
      // The general normaliser strips '#', so a URL run through it never
      // matched the anchored URL a chunk carries.
      const v = checkGrounding({
        reply:
          'Full details: https://1886riyadh.com/policies/refund-policy#returns-exchanges-policy',
        toolResults: [knowledge],
        toolsCalled: ['search_knowledge'],
      });
      expect(v.ok).toBe(true);
    });

    it('still rejects a URL no tool returned', () => {
      const v = checkGrounding({
        reply: 'Start here: https://1886riyadh.com/pages/refund-now',
        toolResults: [knowledge],
        toolsCalled: ['search_knowledge'],
      });
      expect(v.ok).toBe(false);
      expect(v.misses[0]?.kind).toBe('url');
    });

    it('does not read the bare word "available" as a stock claim', () => {
      const v = checkGrounding({
        reply: 'Express delivery is available to every GCC country.',
        toolResults: [knowledge],
        toolsCalled: ['search_knowledge'],
      });
      expect(v.ok).toBe(true);
    });

    it('accepts the brand name when the brand name is a number', () => {
      // The store is called 1886. Without alwaysGrounded, its own name reads
      // as a fabricated four-digit figure.
      const reply = 'I am 1886\u2019s assistant and can help with orders.';
      expect(checkGrounding({ reply, toolResults: [], toolsCalled: [] }).ok).toBe(false);
      expect(
        checkGrounding({ reply, toolResults: [], toolsCalled: [], alwaysGrounded: ['1886'] }).ok,
      ).toBe(true);
    });

    it('does not let alwaysGrounded launder an unrelated number', () => {
      const v = checkGrounding({
        reply: 'Your order 1886204155 shipped.',
        toolResults: [],
        toolsCalled: [],
        alwaysGrounded: ['1886'],
      });
      expect(v.ok).toBe(false);
    });
  });

  it('compares dates as dates, not as prose', () => {
    // A tool returns 2026-09-02T16:10:00Z; a model writes "September 2, 2026".
    // Four verified order lookups were withheld over this.
    const order = {
      ok: true,
      id: 't:order',
      order: {
        number: '#1886-2043',
        shipments: [{ carrier: 'Aramex', updated_at: '2026-09-02T16:10:00Z' }],
      },
    };
    expect(
      checkGrounding({
        reply: 'It was delivered by Aramex on September 2, 2026.',
        toolResults: [order],
        toolsCalled: ['lookup_order'],
      }).ok,
    ).toBe(true);
    expect(
      checkGrounding({
        reply: 'It was delivered on 2 September 2026.',
        toolResults: [order],
        toolsCalled: ['lookup_order'],
      }).ok,
    ).toBe(true);
    const wrong = checkGrounding({
      reply: 'It was delivered on September 9, 2026.',
      toolResults: [order],
      toolsCalled: ['lookup_order'],
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.misses.some((m) => m.kind === 'date')).toBe(true);
  });

  it('leaves small numbers and plain prose alone', () => {
    const v = checkGrounding({
      reply: 'Returns are accepted within 14 days, and sizes run large.',
      toolResults: [],
      toolsCalled: [],
    });
    expect(v.ok).toBe(true);
  });
});
