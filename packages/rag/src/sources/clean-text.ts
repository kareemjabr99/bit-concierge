import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Language } from '@bitc/core';
import type { IngestDocument } from '../ingest.ts';

/**
 * Merchant-exported policy text, dropped in as plain files.
 *
 * A page the merchant exported is cleaner than one reconstructed from theme
 * markup: no navigation, no cookie banner, no "Loading store locator…" where
 * the content should be. It is also the only route for content that never
 * renders as text at all.
 *
 * What arrives is not plain text. These come out of Google Docs, which leaves
 * Markdown behind — `**bold**`, backslash-escaped punctuation, table separator
 * rows, and a BOM on the first line. None of it is content, and all of it
 * reaches a customer if it is indexed: the chunker has no idea `**` is not
 * part of the sentence, and an embedding of "1 \-10 business days" is an
 * embedding of a slightly different phrase than the one anyone will ask about.
 */

/**
 * One artefact class, what it looks like, and what it becomes.
 *
 * Tables are NOT here — they are handled line by line below. A regex with
 * `\s*` anchored to a line end will happily eat the newline and join two table
 * rows into one, which is how "Shipping Cost" and "EXPRESS DELIVERY KSA"
 * became a single word on the first attempt.
 */
const ARTEFACTS: { name: string; pattern: RegExp; replace: string }[] = [
  // Byte-order mark. Invisible, and it lands on the first line, so anything
  // matching on that line silently stops matching.
  { name: 'BOM', pattern: /^\ufeff/, replace: '' },
  // **bold** and *italic*, including the runs Docs leaves around headings.
  // Lookbehind alternative first, or a closing `**` is counted twice: the
  // leading-asterisk branch matches one `*` because the next character is
  // another `*`, which is non-space. The text came out right either way; the
  // number reported to a human did not.
  { name: 'bold/italic marker', pattern: /(?<=\S)\*{1,3}|\*{1,3}(?=\S)/g, replace: '' },
  // Backslash-escaped punctuation: 1 \-10, \(, \., \[.
  { name: 'escaped punctuation', pattern: /\\([-_*.()[\]#+!])/g, replace: '$1' },
  // The space Docs leaves where it broke a range to escape the hyphen:
  // "1 \-10 business days" unescapes to "1 -10", which is not a number range
  // anyone writes and not a string anyone will ask about. Narrow on purpose —
  // digit, space, hyphen, digit — and counted, because silently rewriting a
  // merchant's numbers is exactly the thing not to do quietly.
  { name: 'split numeric range', pattern: /(\d) -(\d)/g, replace: '$1-$2' },
  // Non-breaking and zero-width spaces, which are not the space the tokeniser
  // or a trigram index expects.
  // Alternation rather than a character class: a class containing ZWJ can form
  // joined sequences, and eslint is right to object to one.
  {
    name: 'exotic whitespace',
    pattern: /\u00a0|\u200b|\u200c|\u200d|\u2060/g,
    replace: ' ',
  },
];

const SEPARATOR_ROW = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/**
 * Flattens a Markdown table into one line per row, cells joined by an em dash.
 *
 * Done per line so a row boundary cannot be lost. The cells are content — the
 * delivery estimates live in one — and the pipes are layout.
 */
const flattenTables = (lines: string[]): { lines: string[]; stripped: Record<string, number> } => {
  const stripped: Record<string, number> = {};
  const out: string[] = [];
  for (const line of lines) {
    if (SEPARATOR_ROW.test(line)) {
      stripped['table separator'] = (stripped['table separator'] ?? 0) + 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      stripped['table row'] = (stripped['table row'] ?? 0) + 1;
      out.push(
        line
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0)
          .join(' — '),
      );
      continue;
    }
    out.push(line);
  }
  return { lines: out, stripped };
};

export interface CleanTextNotes {
  sourceId: string;
  title: string;
  /** Artefact class → occurrences removed. Reported so a silent strip is not silent. */
  stripped: Record<string, number>;
  /** Anything the file did that the convention does not describe. */
  warnings: string[];
  chars: number;
}

const normalise = (raw: string): { text: string; stripped: Record<string, number> } => {
  const stripped: Record<string, number> = {};
  let text = raw;
  for (const { name, pattern, replace } of ARTEFACTS) {
    const count = [
      ...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)),
    ].length;
    if (count > 0) stripped[name] = (stripped[name] ?? 0) + count;
    text = text.replace(pattern, replace);
  }

  const table = flattenTables(text.split('\n'));
  Object.assign(stripped, table.stripped);

  return {
    // Collapse the runs of blank lines the stripping leaves behind, and the
    // trailing spaces Docs puts at the end of every paragraph.
    text: table.lines
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    stripped,
  };
};

/**
 * The title comes from the filename. The body keeps every line.
 *
 * The README's convention says the first line is the title, and three of the
 * four merchant exports do not follow it — two open with a full paragraph and
 * one opens with "You are eligible for returns or exchanges within 7 days:",
 * which is the single most-asked fact in the corpus. A heuristic that lifts
 * the first line into the title deletes that sentence from the body on the
 * strength of a guess about punctuation.
 *
 * So there is no guess. `returns-and-exchanges` is a better title than any of
 * those first lines anyway, it is stable, and it is already what citations key
 * on. A first line that does look like a heading is reported rather than
 * consumed, so the convention can be raised with the merchant without any
 * content going missing in the meantime.
 */
const titleFrom = (sourceId: string): string =>
  sourceId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Looks like someone meant it as a heading: short, no terminal punctuation. */
const looksLikeHeading = (line: string): boolean =>
  line.length > 0 && line.length <= 60 && !/[.!?:,;]\s*$/.test(line);

export const loadCleanText = (
  dir: string,
  lang: Language = 'en',
): { documents: IngestDocument[]; notes: CleanTextNotes[] } => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  const documents: IngestDocument[] = [];
  const notes: CleanTextNotes[] = [];

  for (const file of files) {
    const sourceId = basename(file, '.txt');
    const raw = readFileSync(join(dir, file), 'utf8');
    const { text, stripped } = normalise(raw);
    const title = titleFrom(sourceId);
    // Nothing is removed from the body. See titleFrom.
    const body = text;
    const warnings: string[] = [];

    const first =
      text
        .split('\n')
        .find((l) => l.trim().length > 0)
        ?.trim() ?? '';
    if (looksLikeHeading(first) && first.toLowerCase() !== title.toLowerCase()) {
      warnings.push(
        `first line looks like a heading ("${first}") but the title used is "${title}", ` +
          `from the filename. Nothing was dropped.`,
      );
    }

    if (body.trim().length < 200) {
      warnings.push(`only ${body.trim().length} characters of body text — is the export complete?`);
    }
    // A leftover pipe or asterisk means a case ARTEFACTS does not cover, and
    // the point of the census is that nothing passes through unnoticed.
    const leftover = body.match(/\*{2,}|\|\s*:?-{2,}|\\[-_*]/g);
    if (leftover) {
      warnings.push(`${leftover.length} unrecognised markup fragment(s), e.g. ${leftover[0]}`);
    }

    documents.push({
      sourceType: 'policy',
      sourceId,
      title,
      lang,
      content: body,
      url: null,
      metadata: { origin: 'merchant-export', ingestedFrom: file },
    });
    notes.push({ sourceId, title, stripped, warnings, chars: body.length });
  }

  return { documents, notes };
};
