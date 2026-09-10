import { describe, expect, it } from 'vitest';
import { findShippingRule } from '../src/index.ts';

const rules = [
  {
    country: 'SA',
    label: 'Saudi Arabia',
    carrier: 'SMSA',
    range: '2–4 business days',
    cost: 'Free over 300 SAR',
  },
  {
    country: 'AE',
    label: 'United Arab Emirates',
    carrier: 'Aramex',
    range: '3–6 business days',
    cost: '45 SAR',
  },
];

describe('shipping destination matching', () => {
  it('accepts codes, names, aliases and cities in either language', () => {
    for (const input of ['AE', 'ae', 'UAE', 'United Arab Emirates', 'Dubai', 'الإمارات', 'دبي']) {
      expect(findShippingRule(rules, input)?.country, input).toBe('AE');
    }
    expect(findShippingRule(rules, 'KSA')?.country).toBe('SA');
    expect(findShippingRule(rules, 'Saudi Arabia', 'Riyadh')?.country).toBe('SA');
  });

  it('falls back to the city when the country is unhelpful', () => {
    expect(findShippingRule(rules, 'Gulf', 'Jeddah')?.country).toBe('SA');
  });

  it('returns nothing for a destination the store does not publish', () => {
    expect(findShippingRule(rules, 'Egypt', 'Cairo')).toBeUndefined();
  });
});
