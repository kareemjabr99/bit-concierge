/**
 * Structural chunking. Documents are split on their own headings first, and
 * only oversized sections are split further — a chunk should be a thing the
 * document itself treats as a unit, not an arbitrary window.
 *
 * Every chunk keeps the heading trail it sits under, so retrieval can show a
 * customer where an answer came from and the citation gate can resolve it.
 */

export interface ChunkInput {
  /** Markdown-ish text: `#` headings, blank-line-separated paragraphs. */
  content: string;
  /** Document title, used as the outermost heading. */
  title?: string | undefined;
  /** Base URL. Headings become `#anchor` fragments beneath it. */
  url?: string | undefined;
}

export interface Chunk {
  ordinal: number;
  content: string;
  headingPath: string[];
  url: string | null;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target size. Sections larger than this are split on paragraph bounds. */
  targetTokens?: number;
  /** Hard ceiling. The embedding model's input cap is the real constraint. */
  maxTokens?: number;
  /** Sentences of the previous chunk repeated at the head of the next. */
  overlapSentences?: number;
  /** Chunks shorter than this are merged into their neighbour. */
  minTokens?: number;
}

const DEFAULTS = {
  targetTokens: 400,
  maxTokens: 500,
  overlapSentences: 1,
  minTokens: 40,
} satisfies Required<ChunkOptions>;

/**
 * Token estimate without a tokenizer dependency. Latin text runs ~4 characters
 * per token; Arabic is denser per character, so it is counted at ~2.
 * Deliberately conservative — over-estimating splits early, which is safe;
 * under-estimating overruns the provider's 2,048-token input cap, which is not.
 */
export const estimateTokens = (text: string): number => {
  const arabic = (text.match(/[؀-ۿ]/gu) ?? []).length;
  const rest = text.length - arabic;
  return Math.ceil(arabic / 2 + rest / 4);
};

export const slugify = (heading: string): string =>
  heading
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

interface Section {
  headingPath: string[];
  anchor: string | null;
  paragraphs: string[];
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

/** Splits on headings, carrying the heading trail down. */
const sections = (content: string, title?: string): Section[] => {
  const root = title ? [title] : [];
  const out: Section[] = [{ headingPath: root, anchor: null, paragraphs: [] }];
  let path = root;

  for (const block of content.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    const heading = HEADING.exec(text);
    if (heading) {
      const depth = heading[1]!.length;
      const label = heading[2]!;
      path = [...root, ...path.slice(root.length, depth - 1), label];
      out.push({ headingPath: path, anchor: slugify(label), paragraphs: [] });
      continue;
    }
    out[out.length - 1]!.paragraphs.push(text);
  }
  return out.filter((s) => s.paragraphs.length > 0);
};

const SENTENCE = /(?<=[.!?؟۔])\s+/;

/** Packs paragraphs up to the target, splitting a huge paragraph on sentences. */
const pack = (paragraphs: string[], options: Required<ChunkOptions>): string[] => {
  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (estimateTokens(paragraph) <= options.maxTokens) {
      units.push(paragraph);
      continue;
    }
    let buffer = '';
    for (const sentence of paragraph.split(SENTENCE)) {
      const candidate = buffer ? `${buffer} ${sentence}` : sentence;
      if (buffer && estimateTokens(candidate) > options.targetTokens) {
        units.push(buffer);
        buffer = sentence;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) units.push(buffer);
  }

  const packed: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (current && estimateTokens(candidate) > options.targetTokens) {
      packed.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) packed.push(current);
  return packed;
};

const tail = (text: string, sentences: number): string =>
  text.split(SENTENCE).slice(-sentences).join(' ').trim();

export const chunk = (input: ChunkInput, options: ChunkOptions = {}): Chunk[] => {
  const opts = { ...DEFAULTS, ...options };
  const chunks: Chunk[] = [];

  for (const section of sections(input.content, input.title)) {
    const packed = pack(section.paragraphs, opts);
    packed.forEach((body, index) => {
      // Overlap carries the previous chunk's last sentence forward, so a fact
      // split across a boundary is retrievable from either side.
      const previous = index > 0 ? tail(packed[index - 1]!, opts.overlapSentences) : '';
      const content = previous && !body.startsWith(previous) ? `${previous} ${body}` : body;
      chunks.push({
        ordinal: chunks.length,
        content,
        headingPath: section.headingPath,
        url: input.url ? (section.anchor ? `${input.url}#${section.anchor}` : input.url) : null,
        tokenCount: estimateTokens(content),
      });
    });
  }

  // A stub chunk retrieves badly and dilutes the index. Fold it backwards.
  const merged: Chunk[] = [];
  for (const item of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      item.tokenCount < opts.minTokens &&
      previous.headingPath.join('>') === item.headingPath.join('>') &&
      estimateTokens(`${previous.content}\n\n${item.content}`) <= opts.maxTokens
    ) {
      previous.content = `${previous.content}\n\n${item.content}`;
      previous.tokenCount = estimateTokens(previous.content);
      continue;
    }
    merged.push({ ...item, ordinal: merged.length });
  }
  return merged;
};
