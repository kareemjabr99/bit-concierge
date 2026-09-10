import { describe, expect, it } from 'vitest';
import { extractPage, productDocument } from '../src/index.ts';

describe('storefront HTML extraction', () => {
  it('keeps headings and drops theme machinery', () => {
    const page = extractPage(
      `<html><head><title>Refund policy – 1886 riyadh</title></head><body><nav>Shop Menu</nav>
       <main><h2>Returns &amp; Exchanges</h2><p>Eligible within 7 days.</p>
       <script>var theme = 1;</script><p>Proof of purchase required.</p></main>
       <footer>Newsletter</footer></body></html>`,
    );
    expect(page.title).toBe('Refund policy');
    expect(page.content).toContain('### Returns & Exchanges');
    expect(page.content).toContain('Eligible within 7 days.');
    expect(page.content).not.toContain('theme');
    expect(page.content).not.toContain('Newsletter');
  });

  it('keeps a size chart’s rows intact — cells wrap their values in <p>', () => {
    const page = extractPage(
      `<main><table><tr><td><p>CHEST</p></td><td><p>51</p></td><td><p>55</p></td></tr>
       <tr><td><p>SLEEVE</p></td><td><p>18</p></td><td><p>19</p></td></tr></table></main>`,
    );
    expect(page.content).toContain('CHEST | 51 | 55');
    expect(page.content).toContain('SLEEVE | 18 | 19');
  });

  it('builds product copy without stock, which is a tool call', () => {
    const doc = productDocument(
      {
        id: 1,
        title: 'Classic Hoodie',
        handle: 'classic-hoodie',
        body_html: '<p>Heavyweight cotton.</p>',
        product_type: 'HOODIE',
        tags: ['hoodie'],
        variants: [
          { title: 'M', price: '450.00', available: true, sku: 'A' },
          { title: 'L', price: '450.00', available: false, sku: 'B' },
        ],
      },
      'https://example.test',
    );
    expect(doc.content).toContain('Heavyweight cotton.');
    expect(doc.content).toContain('Available sizes: M, L.');
    expect(doc.content).toContain('450 SAR');
    expect(doc.content).toContain('https://example.test/products/classic-hoodie');
    // Availability must never enter the index; a stale "in stock" is the
    // failure the brief opens with.
    expect(doc.content.toLowerCase()).not.toContain('in stock');
    expect(doc.content.toLowerCase()).not.toContain('out of stock');
  });
});
