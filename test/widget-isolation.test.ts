import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Structural invariants of the embed, asserted against its source.
 *
 * **These are weaker than a real browser test and it is worth being plain
 * about that.** A source assertion proves the code says `mode: 'closed'`; only
 * a browser proves the shadow tree is actually unreachable. The stronger test
 * needs a DOM implementation, and the two available cost forty-odd packages in
 * a repository with a three-day release-age floor — one of which is currently
 * broken on Node 24, which is how this came up.
 *
 * So the widget's logic was split into conversation.ts and tested properly
 * with no dependencies at all, and what remains in widget.ts is element
 * creation and appending. These four rules cover the parts of that which are
 * security properties rather than layout, and they fail loudly if someone
 * changes one by accident. A real browser check belongs in the Phase 3 demo
 * script, against the built bundle.
 */

const SOURCE = readFileSync('apps/widget/src/widget.ts', 'utf8');

describe('storefront isolation', () => {
  it('is reading the widget it thinks it is', () => {
    // Without this, a renamed file makes every rule below vacuous.
    expect(SOURCE).toContain('mountWidget');
    expect(SOURCE.length).toBeGreaterThan(2000);
  });

  it('attaches a CLOSED shadow root', () => {
    // A storefront theme is other people's code in the same document. Closed
    // means a theme script cannot read the conversation or restyle it through
    // element.shadowRoot.
    expect(SOURCE).toMatch(/attachShadow\(\{\s*mode:\s*'closed'\s*\}\)/);
    expect(SOURCE).not.toContain("mode: 'open'");
  });

  it('resets inherited styling at the boundary', () => {
    // The other direction: the merchant's CSS must not reach in either. A
    // theme that styles every div would otherwise redecorate the widget.
    expect(SOURCE).toContain(':host { all: initial; }');
  });

  it('never assigns innerHTML or outerHTML', () => {
    // The reply is the merchant's own policy text, returned by a model.
    // Treating it as markup would make a store document an injection vector
    // into the storefront — and the store document is the one thing this
    // product promises to quote faithfully.
    expect(SOURCE).not.toMatch(/\.(inner|outer)HTML\s*=/);
    expect(SOURCE).not.toContain('insertAdjacentHTML');
    expect(SOURCE).toContain('node.textContent = text');
  });

  it('opens citation links without handing over window.opener', () => {
    expect(SOURCE).toMatch(/link\.rel = 'noopener noreferrer'/);
  });

  it('gives every control a 44px tap target', () => {
    // KSA storefront traffic is roughly 78% mobile, so a phone is the common
    // case rather than an accessibility afterthought. Apple and Material both
    // say 44 CSS px; WCAG 2.2's floor of 24 is too low to be useful here.
    //
    // This is a structural check on the stylesheet, not a rendered
    // measurement, and it is here because the worst offender — the close
    // button at about 29px — looked completely fine in a desktop screenshot.
    // Interactive verification on a real phone is still an open item in the
    // Phase 3 demo script.
    const style = SOURCE.slice(SOURCE.indexOf('const STYLE'), SOURCE.indexOf('export interface'));
    const blockFor = (selector: string): string => {
      const at = style.indexOf(`${selector} {`);
      if (at < 0) return '';
      return style.slice(at, style.indexOf('}', at) + 1);
    };
    for (const selector of ['.launcher', 'header button', 'input', 'form button']) {
      const block = blockFor(selector);
      expect(block, `no style block found for "${selector}"`).not.toBe('');
      expect(block, `"${selector}" has no min-height — it is a tap target`).toContain(
        'min-height: 44px',
      );
    }
  });

  it('uses a 16px input font, so iOS does not zoom on focus', () => {
    // Safari zooms the whole page when a focused input is under 16px, which on
    // a storefront means the merchant's page jumps the moment someone taps the
    // chat box. Nothing in the widget can undo it afterwards.
    const style = SOURCE.slice(SOURCE.indexOf('const STYLE'), SOURCE.indexOf('export interface'));
    const input = /\binput\s*\{[^}]*\}/.exec(style)?.[0] ?? '';
    expect(input).toMatch(/font-size:\s*1[6-9]px/);
  });
});
