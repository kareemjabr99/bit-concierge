import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MERCHANT_COPY_NOTICE, systemMessage } from '../packages/agent/src/prompt/messages.ts';

/**
 * `policy_overrides.messages` is the one customer-facing path with no
 * grounding check on it. A merchant's override is returned verbatim; it never
 * passes through the model, so neither the literal gate nor the citation gate
 * ever sees it.
 *
 * This suite does NOT gate that copy, and must never be changed to. A
 * merchant's own words about their own business are theirs. What it does is
 * hold the two things that make the gap honest rather than hidden: the
 * mechanism stays as it is, and the person typing is told.
 */

describe('merchant copy is ungated, and stays that way', () => {
  it('returns an override verbatim', () => {
    // Deliberately a claim no gate would pass: a specific, unsourced,
    // falsifiable policy statement. It comes back untouched. That is the
    // documented behaviour, not a bug, and this test exists to make a future
    // change to it deliberate rather than accidental.
    const invented = 'Returns accepted for 90 days, no receipt needed, shipping refunded.';
    expect(systemMessage('escalated', 'en', { en: { escalated: invented } })).toBe(invented);
  });

  it('falls back to system copy when the merchant has written none', () => {
    expect(systemMessage('escalated', 'en', {})).toContain('passed this to the team');
    expect(systemMessage('escalated', 'en', undefined)).toContain('passed this to the team');
  });
});

describe('the person typing is told', () => {
  it('says who wrote it and that nothing checks it', () => {
    // The two facts the notice exists to convey. Worded loosely on purpose —
    // this checks the meaning survives an edit, not that the copy is frozen.
    expect(MERCHANT_COPY_NOTICE.en).toMatch(/you are writing this/i);
    expect(MERCHANT_COPY_NOTICE.en).toMatch(/nothing checks it/i);
    expect(MERCHANT_COPY_NOTICE.en).toMatch(/exactly as typed/i);
  });

  it('exists in every language the product supports', () => {
    expect(Object.keys(MERCHANT_COPY_NOTICE).sort()).toEqual(['ar', 'en']);
    for (const [lang, text] of Object.entries(MERCHANT_COPY_NOTICE)) {
      expect(text.trim().length, `${lang} notice is empty`).toBeGreaterThan(40);
    }
  });

  it('is readable in the source, not escaped', () => {
    // A Phase 5 native reviewer has to be able to read the Arabic to review
    // it. هذا is not reviewable copy.
    const source = readFileSync('packages/agent/src/prompt/messages.ts', 'utf8');
    const notice = source.slice(source.indexOf('MERCHANT_COPY_NOTICE'));
    expect(notice).not.toMatch(/\\u[0-9a-f]{4}/i);
    expect(notice).toMatch(/[؀-ۿ]/);
  });

  it('reaches the screen where the typing happens', () => {
    // Self-activating. The dashboard does not exist yet, so today this finds
    // nothing and passes. The day someone writes an editor for these
    // overrides, the rule binds without anyone remembering it existed — which
    // is the only kind of rule that survives a phase boundary.
    const editors = globSync('apps/*/src/**/*.{ts,tsx}').filter((path) => {
      const content = readFileSync(path, 'utf8');
      // A file that both names the override channel and takes text input is
      // the screen in question.
      return (
        /policy_?[oO]verrides|SystemMessageKey|systemMessage/.test(content) &&
        /<textarea|<input|<Textarea|<Input|form/i.test(content)
      );
    });

    for (const path of editors) {
      expect(
        readFileSync(path, 'utf8'),
        `${path} edits merchant copy but does not show MERCHANT_COPY_NOTICE. The person ` +
          `typing needs to know nothing checks it. Import it from @bitc/agent rather than ` +
          `writing the wording again — see docs/adr/0005-grounding.md.`,
      ).toMatch(/MERCHANT_COPY_NOTICE/);
    }
  });
});
