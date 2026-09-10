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

  it('leaves small numbers and plain prose alone', () => {
    const v = checkGrounding({
      reply: 'Returns are accepted within 14 days, and sizes run large.',
      toolResults: [],
      toolsCalled: [],
    });
    expect(v.ok).toBe(true);
  });
});
