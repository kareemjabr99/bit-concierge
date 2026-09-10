/**
 * Storefront HTML to structured text.
 *
 * A Shopify page is ~400 KB of theme markup around a few hundred words of
 * content. This pulls out the content and keeps its headings, because the
 * chunker splits on headings and every chunk carries its heading trail.
 *
 * Regex, not a DOM library: the shapes here are narrow and adding a parser to
 * the dependency tree for them is not a trade worth making. If the extraction
 * ever needs to handle arbitrary HTML, that is the point to reach for one.
 */

const BLOCK_NOISE =
  /<(script|style|noscript|svg|template|nav|header|footer|form|select|button)\b[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

const decode = (text: string): string =>
  text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const key = entity.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
      return match;
    })
    .replace(/\u00a0/g, ' ');

/** The smallest container that plausibly holds the page body. */
const body = (html: string): string => {
  for (const pattern of [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<[^>]*\bclass="[^"]*\b(?:rte|page-content|shopify-policy__body)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]) {
    const found = pattern.exec(html);
    if (found?.[1] && found[1].length > 200) return found[1];
  }
  return html;
};

export interface ExtractedPage {
  title: string | null;
  /** Markdown-ish: `##` headings, blank-line-separated blocks. */
  content: string;
}

const titleOf = (html: string): string | null => {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html);
  if (og?.[1]) return decode(og[1]).trim();
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return tag?.[1]
    ? decode(tag[1])
        .replace(/\s*[|–—-]\s*1886.*$/i, '')
        .trim()
    : null;
};

export const extractPage = (html: string): ExtractedPage => {
  let text = body(html).replace(COMMENT, ' ').replace(BLOCK_NOISE, ' ');

  // Tables first, and whole: a size chart's cells wrap their values in <p>,
  // which the block rules below would turn into paragraph breaks — one
  // measurement per line, and the row that gave it meaning gone.
  text = text.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (table) =>
      `\n\n${table
        .replace(/<\/tr>/gi, '\u0001')
        .replace(/<\/t[dh]>/gi, '\u0002')
        .replace(/<[^>]+>/g, ' ')
        .split('\u0001')
        .map((row) =>
          row
            .split('\u0002')
            .map((cell) => decode(cell).replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' | '),
        )
        .filter(Boolean)
        .join('\n')}\n\n`,
  );

  text = text
    .replace(/<\/(li|p|div|section|article|figcaption|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
      const heading = decode(inner.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      return heading ? `\n\n${'#'.repeat(Math.min(Number(level) + 1, 6))} ${heading}\n\n` : '\n\n';
    })
    .replace(/<[^>]+>/g, ' ');

  const content = decode(text)
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\|\s*$/, '')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');

  return { title: titleOf(html), content };
};

/** A Shopify product from the public products.json feed. */
export interface PublicProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  product_type: string;
  tags: string[];
  variants: { title: string; price: string; available: boolean; sku: string | null }[];
}

/**
 * Product copy as a document. Variant availability is deliberately absent —
 * stock is a tool call, never retrieval, and a stale "in stock" in the index
 * is exactly the failure the brief opens with.
 */
export const productDocument = (product: PublicProduct, storeUrl: string): ExtractedPage => {
  const description = extractPage(product.body_html).content;
  const prices = product.variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
  const lines = [
    `## ${product.title}`,
    description,
    product.product_type ? `Category: ${product.product_type}.` : '',
    product.variants.length
      ? `Available sizes: ${product.variants.map((v) => v.title).join(', ')}.`
      : '',
    prices.length
      ? `Listed price: ${Math.min(...prices)}${Math.max(...prices) !== Math.min(...prices) ? `–${Math.max(...prices)}` : ''} SAR.`
      : '',
    product.tags.length ? `Tags: ${product.tags.join(', ')}.` : '',
    `Product page: ${storeUrl}/products/${product.handle}`,
  ];
  return { title: product.title, content: lines.filter(Boolean).join('\n\n') };
};
