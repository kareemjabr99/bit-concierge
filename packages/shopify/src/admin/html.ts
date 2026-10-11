/**
 * A product's `descriptionHtml` as plain text. Text out, never HTML: nothing
 * downstream renders the result.
 *
 * **Why not Shopify's own `description` field.** It is the HTML with the tags
 * removed and nothing put in their place, and it collapses whitespace besides.
 * A size chart written as a table arrives as one run of words — "Size Chest S
 * 57 M 60" — with the row boundaries gone. Every number is still in the text,
 * so the literal gate passes whichever size the model pairs it with. That is
 * the table-row defect from Phase 2 again, and it is invisible to every
 * check that looks at numbers rather than at lines. Row boundaries are the
 * data; this keeps them.
 *
 * Rules:
 * - Raw whitespace in the source is whitespace, as in a browser. Only tags
 *   make line breaks, so `<br>` followed by a newline is one break, not two.
 * - `<br>` and block elements end a line. A table row is a line; its cells are
 *   joined with " · ", the form the seed data and the mock already use.
 * - `<script>` and `<style>` content is dropped, not emitted as text.
 * - Entities are decoded (named, decimal and hex), once, after the tags are
 *   gone — so `&lt;b&gt;` comes out as the characters `<b>`, not as markup
 *   that was never there.
 */

const CELL = '\u0001';
const BREAK = '\u0002';

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  times: '×',
  deg: '°',
  frac12: '½',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z][a-z\d]*));/gi, (whole, dec, hex, name) => {
    if (name !== undefined) return NAMED[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const BLOCK =
  'p|div|li|ul|ol|tr|table|thead|tbody|tfoot|caption|h[1-6]|blockquote|section|article|header|footer|pre|hr|dl|dt|dd|figure|figcaption';

/** The inside of a tag: quoted attribute values may contain `>`. */
const INSIDE = `(?:[^>"']|"[^"]*"|'[^']*')*`;
/** A block boundary, kept apart from <br> so an open and a close tag are one break, not two. */
const BLOCK_BREAK = '\u0003';

export const htmlToText = (html: string): string => {
  const withBreaks = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`<br\\b${INSIDE}>`, 'gi'), BREAK)
    .replace(new RegExp(`</?(?:${BLOCK})\\b${INSIDE}>`, 'gi'), BLOCK_BREAK)
    .replace(new RegExp(`${BLOCK_BREAK}(?:\\s*${BLOCK_BREAK})+`, 'g'), BLOCK_BREAK)
    .replaceAll(BLOCK_BREAK, BREAK)
    .replace(new RegExp(`<t[dh]\\b${INSIDE}>`, 'gi'), CELL)
    .replace(new RegExp(`</?[a-z]${INSIDE}>`, 'gi'), '');

  const lines = withBreaks.split(BREAK).map((line) => {
    if (!line.includes(CELL)) return decodeEntities(line).trim();
    const [before, ...cells] = line.split(CELL);
    const parts = [before, ...cells].map((cell) => decodeEntities(cell ?? '').trim());
    // Cells before the first marker are text outside any cell; keep it only if there is some.
    if (parts[0] === '') parts.shift();
    return parts.join(' · ');
  });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
