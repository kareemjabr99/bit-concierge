import { describe, expect, it } from 'vitest';
import { htmlToText, toProduct } from '../src/index.ts';
import { PRODUCTS, describeProduct } from '../scripts/seed-data.ts';
import { JACKET } from './shapes.ts';

/**
 * Size charts are tables. Flattened, "S 57 68 M 60 71" keeps every number and
 * loses which row each belongs to, so the literal gate passes whichever size
 * the model pairs a measurement with. These tests look at lines, not numbers.
 */

describe('descriptionHtml to text', () => {
  it('keeps each row of a size-chart table on its own line', () => {
    // A merchant-style table: the shape a real storefront publishes. Synthetic
    // — the seed writes <br>, not tables — so the converter is tested on both.
    const html =
      '<p>Boxy tee.</p><table><thead><tr><th>Size</th><th>Chest (cm)</th><th>Length (cm)</th></tr></thead>' +
      '<tbody><tr><td>S</td><td>57</td><td>68</td></tr><tr><td>M</td><td>60</td><td>71</td></tr>' +
      '<tr><td>L</td><td>63</td><td>74</td></tr></tbody></table>';
    expect(htmlToText(html).split('\n')).toEqual([
      'Boxy tee.',
      'Size · Chest (cm) · Length (cm)',
      'S · 57 · 68',
      'M · 60 · 71',
      'L · 63 · 74',
    ]);
  });

  it('does not let a measurement drift onto a neighbouring size', () => {
    const rows = htmlToText(
      '<table><tr><td>S</td><td>57</td></tr><tr><td>M</td><td>60</td></tr></table>',
    ).split('\n');
    expect(rows.find((r) => r.startsWith('M'))).toBe('M · 60');
    expect(rows.find((r) => r.startsWith('S'))).toBe('S · 57');
  });

  it('keeps an empty cell, so a column cannot slide left', () => {
    expect(htmlToText('<table><tr><td>S</td><td></td><td>68</td></tr></table>')).toBe('S ·  · 68');
  });

  it('turns a <br> into one break, whether or not a newline follows it', () => {
    expect(htmlToText('a<br>b<br>\nc')).toBe('a\nb\nc');
    expect(htmlToText('a<br>\n<br>\nb')).toBe('a\n\nb');
  });

  it('treats raw newlines in the source as whitespace, as a browser does', () => {
    expect(htmlToText('one\ntwo\n\nthree')).toBe('one two three');
  });

  it('ends a line at block elements and lists', () => {
    expect(htmlToText('<h2>Fit</h2><p>Regular.</p><ul><li>Cotton</li><li>320gsm</li></ul>')).toBe(
      'Fit\nRegular.\nCotton\n320gsm',
    );
  });

  it('decodes entities once, and never turns them into markup', () => {
    expect(htmlToText('Tom &amp; Jerry &#8211; 5&nbsp;cm &#x2022; &lt;b&gt;')).toBe(
      'Tom & Jerry – 5 cm • <b>',
    );
    // Double-encoded stays one level decoded.
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });

  it('leaves an unknown entity as written rather than inventing text', () => {
    expect(htmlToText('a &bogus; b')).toBe('a &bogus; b');
  });

  it('drops script and style content instead of emitting it as text', () => {
    expect(htmlToText('hi<script>alert(1)</script><style>p{x:y}</style>there')).toBe('hi there');
  });

  it('strips tags that carry attributes, including ones containing >', () => {
    expect(htmlToText('<a href="/x" title="a>b">link</a> <span style="color:red">red</span>')).toBe(
      'link red',
    );
  });

  it.each(PRODUCTS)(
    'turns the HTML the seed writes for $handle back into the mock’s description',
    (p) => {
      // The seed's own encoding: newline -> <br>\n. The store round-trips it,
      // so this is what the live read returns, and compare:store holds it to
      // the mock row for row.
      const html = describeProduct(p).replace(/\n/g, '<br>\n');
      expect(htmlToText(html)).toBe(describeProduct(p));
    },
  );

  it('maps a product from descriptionHtml, not from Shopify’s flattened description', () => {
    const product = toProduct({
      ...JACKET,
      descriptionHtml:
        '<table><tr><td>M</td><td>60</td></tr><tr><td>L</td><td>63</td></tr></table>',
    });
    expect(product.description).toBe('M · 60\nL · 63');
  });
});
