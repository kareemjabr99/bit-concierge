/**
 * Everything the widget does that is not drawing.
 *
 * Split out so it can be tested without a browser. The alternative was a DOM
 * shim, and the two candidates cost forty-odd packages in a repository with a
 * three-day release-age floor and a strict lockfile — one of which was already
 * broken on Node 24. A test dependency that large, to cover four hundred lines
 * of widget, is a bad trade twice over.
 *
 * What is left in widget.ts after this is element creation and appending,
 * which is short enough to read.
 */

export type Lang = 'en' | 'ar';

export interface Source {
  title: string;
  url: string | null;
}

export interface Reply {
  token: string;
  status: string;
  reply: string;
  lang: Lang;
  sources: Source[];
}

export type StreamEvent =
  { kind: 'stage'; label: string } | { kind: 'reply'; reply: Reply } | { kind: 'error' };

/**
 * Incremental server-sent-event parser.
 *
 * Stateful because a network chunk boundary falls wherever it likes, including
 * halfway through an event. Anything after the last blank line is held until
 * the rest of it arrives — a parser that assumed whole events would drop the
 * reply on a slow connection and show the customer a wait that never ends.
 */
export class EventStream {
  private buffer = '';
  private lastLabel: string | null = null;

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    const events: StreamEvent[] = [];
    for (const block of blocks) {
      const name = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      if (!name || !raw) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // A malformed frame is skipped, not fatal. The reply may still arrive.
        continue;
      }
      if (name === 'stage' && typeof data.label === 'string') {
        // Belt and braces: the server already collapses repeats, and a repeat
        // that got through would read as a stutter rather than as progress.
        if (data.label === this.lastLabel) continue;
        this.lastLabel = data.label;
        events.push({ kind: 'stage', label: data.label });
      } else if (name === 'reply') {
        events.push({ kind: 'reply', reply: data as unknown as Reply });
      } else if (name === 'error') {
        events.push({ kind: 'error' });
      }
    }
    return events;
  }
}

/**
 * The conversation token, kept per browser.
 *
 * localStorage rather than a cookie: the endpoint is cross-origin from the
 * storefront and a third-party cookie is not a thing to build on in 2026.
 *
 * Every access is guarded because Safari in private mode throws on
 * localStorage rather than returning null. A storefront widget that crashes on
 * a privacy setting is worse than one that forgets a conversation, and
 * forgetting is the correct failure here: the token only ever unlocks its own
 * history.
 */
export class TokenStore {
  static readonly KEY = 'bitc.token';
  private readonly backing: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(backing?: Pick<Storage, 'getItem' | 'setItem'> | null) {
    this.backing = backing ?? null;
  }

  read(): string | null {
    try {
      return this.backing?.getItem(TokenStore.KEY) ?? null;
    } catch {
      return null;
    }
  }

  write(token: string): void {
    try {
      this.backing?.setItem(TokenStore.KEY, token);
    } catch {
      /* A visitor who blocks storage gets a fresh conversation each load. */
    }
  }
}

/**
 * The widget's own language, from the page.
 *
 * Not the browser's. A Saudi storefront served in English should stay in
 * English: the merchant chose the page's language and the widget is part of
 * the page. The agent detects the language of each message separately and
 * answers in it — this governs the furniture only.
 */
export const langFromDocument = (documentLang: string): Lang =>
  documentLang.toLowerCase().startsWith('ar') ? 'ar' : 'en';

export const requestBody = (
  widgetKey: string,
  text: string,
  lang: Lang,
  token: string | null,
): string => JSON.stringify({ widgetKey, text, locale: lang, ...(token ? { token } : {}) });

/** Citations worth rendering: a source with no URL is not a link. */
export const linkableSources = (sources: Source[]): (Source & { url: string })[] =>
  sources.filter((s): s is Source & { url: string } => typeof s.url === 'string' && s.url !== '');
