import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCleanText } from '../src/sources/clean-text.ts';

/**
 * The merchant's exports come out of Google Docs, and what arrives is not
 * plain text. Every case here is an artefact that was actually in the four
 * files 1886 sent, and two of them mangled the content on the first attempt.
 */

const withFiles = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bitc-clean-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};

const load = (content: string, name = 'shipping-policy.txt') =>
  loadCleanText(withFiles({ [name]: content })).documents[0]!;

describe('merchant export normalisation', () => {
  it('strips bold markers without touching the words', () => {
    expect(load('**Shipping rates & delivery estimates**\n\nCharges apply.').content).toContain(
      'Shipping rates & delivery estimates',
    );
    expect(load('**Shipping rates**\n\nCharges apply.').content).not.toContain('*');
  });

  it('unescapes punctuation and closes the gap the escape left', () => {
    // The real one: "1 \-10 business days" is what Docs wrote for "1-10".
    // Unescaping alone leaves "1 -10", which is not a range anyone writes and
    // not a string anyone will ask about.
    const doc = load('Policy\n\nAll orders are processed within 1 \\-10 business days.');
    expect(doc.content).toContain('1-10 business days');
    expect(doc.content).not.toContain('\\');
  });

  it('only closes that gap between digits', () => {
    // Narrow on purpose. Rewriting a merchant's text is a thing to do as
    // little of as possible.
    const doc = load('Policy\n\nReturns - not exchanges - need a receipt within 7 days.');
    expect(doc.content).toContain('Returns - not exchanges - need a receipt');
  });

  it('flattens a table without losing the row boundary', () => {
    // The first attempt joined these into "Shipping CostEXPRESS DELIVERY KSA",
    // because a line-anchored \s* ate the newline between them. The delivery
    // estimates live in this table; merging rows merges the estimates.
    const doc = load(
      [
        'Shipping Policy',
        '',
        '| Shipping Method | Estimated Delivery time | Shipping Cost |',
        '| :---- | :---- | :---- |',
        '| EXPRESS DELIVERY KSA | 1 TO 7 BUSINESS DAYS | Varies by destination |',
        '| DHL EXPRESS WORLDWIDE | 5 TO 10 BUSINESS DAYS | Varies by destination |',
      ].join('\n'),
    );
    const lines = doc.content.split('\n').filter((l) => l.includes('—'));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('EXPRESS DELIVERY KSA — 1 TO 7 BUSINESS DAYS — Varies by destination');
    expect(doc.content).not.toContain('CostEXPRESS');
    expect(doc.content).not.toMatch(/:-{2,}/);
  });

  it('strips the BOM that lands on the first line', () => {
    const doc = load('﻿Introduction\n\nWelcome to the store.');
    expect(doc.content.startsWith('Introduction')).toBe(true);
  });

  it('takes the title from the filename and keeps every line of the body', () => {
    // The returns export opens with "You are eligible for returns or exchanges
    // within 7 days:" — the most-asked fact in the corpus. A heuristic that
    // lifted the first line into the title would have deleted it from the body.
    const doc = load(
      ' \nYou are eligible for returns or exchanges within 7 days:\n\nItems must be unused.',
      'returns-and-exchanges.txt',
    );
    expect(doc.title).toBe('Returns And Exchanges');
    expect(doc.content).toContain('within 7 days');
  });

  it('reports what it removed rather than removing it quietly', () => {
    const { notes } = loadCleanText(
      withFiles({
        'shipping-policy.txt':
          'Policy\n\n**Rates**\n\nProcessed within 1 \\-10 days.\n\n| A | B |\n| :-- | :-- |\n| 1 | 2 |\n' +
          'Padding so the body clears the completeness check. '.repeat(6),
      }),
    );
    expect(notes[0]!.stripped).toMatchObject({
      'bold/italic marker': 2,
      'escaped punctuation': 1,
      'split numeric range': 1,
      'table separator': 1,
      'table row': 2,
    });
  });

  it('warns on a body too short to be a complete export', () => {
    const { notes } = loadCleanText(withFiles({ 'shipping-policy.txt': 'Policy\n\nShort.' }));
    expect(notes[0]!.warnings.join(' ')).toContain('is the export complete?');
  });

  it('warns about markup it does not recognise instead of indexing it', () => {
    const { notes } = loadCleanText(
      withFiles({
        'terms-of-service.txt':
          'Terms\n\n~~struck through~~ and <sup>2</sup>\n' +
          'Padding so the body clears the completeness check. '.repeat(6),
      }),
    );
    // ~~ and <sup> are not in ARTEFACTS. The point is that anything unhandled
    // is reported rather than passing through into a customer-facing chunk.
    expect(notes[0]!.warnings.length).toBeGreaterThan(0);
  });
});
