import { describe, expect, it } from 'vitest';
import {
  EventStream,
  langFromDocument,
  linkableSources,
  requestBody,
  TokenStore,
} from '../src/conversation.ts';

const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const REPLY = {
  token: 'nonce0000000000000000.tag00000000000000',
  status: 'answered',
  reply: 'Returns are accepted within 7 days.',
  lang: 'en' as const,
  sources: [{ title: 'Refund policy', url: 'https://1886riyadh.com/policies/refund-policy' }],
};

describe('event stream', () => {
  it('reads stages and the reply in order', () => {
    const stream = new EventStream();
    const events = stream.push(
      frame('open', { token: 'x' }) +
        frame('stage', { tool: 'search_knowledge', label: "Checking the store's policies" }) +
        frame('stage', { tool: 'lookup_order', label: 'Looking up your order' }) +
        frame('reply', REPLY),
    );
    expect(events.map((e) => e.kind)).toEqual(['stage', 'stage', 'reply']);
    expect(events[0]).toEqual({ kind: 'stage', label: "Checking the store's policies" });
  });

  it('holds a half-arrived event until the rest turns up', () => {
    // A network chunk boundary falls wherever it likes, including mid-frame.
    // A parser that assumed whole events would drop the reply on a slow
    // connection and leave the customer watching a wait that never ends.
    const stream = new EventStream();
    const whole = frame('reply', REPLY);
    const cut = Math.floor(whole.length / 2);
    expect(stream.push(whole.slice(0, cut))).toEqual([]);
    const events = stream.push(whole.slice(cut));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'reply' });
  });

  it('survives being fed one character at a time', () => {
    const stream = new EventStream();
    const all = frame('stage', { label: 'Looking up your order' }) + frame('reply', REPLY);
    const events = [...all].flatMap((c) => stream.push(c));
    expect(events.map((e) => e.kind)).toEqual(['stage', 'reply']);
  });

  it('collapses a repeated stage', () => {
    const stream = new EventStream();
    const events = stream.push(
      frame('stage', { label: "Checking the store's policies" }) +
        frame('stage', { label: "Checking the store's policies" }) +
        frame('stage', { label: 'Looking up your order' }),
    );
    expect(events).toHaveLength(2);
  });

  it('skips a malformed frame rather than giving up on the turn', () => {
    const stream = new EventStream();
    const events = stream.push('event: stage\ndata: {not json\n\n' + frame('reply', REPLY));
    expect(events.map((e) => e.kind)).toEqual(['reply']);
  });

  it('reports an error event so the widget can stop waiting', () => {
    const stream = new EventStream();
    expect(stream.push(frame('error', { error: 'turn_failed' }))).toEqual([{ kind: 'error' }]);
  });

  it('ignores events it does not know', () => {
    const stream = new EventStream();
    expect(stream.push(frame('open', { token: 'x' }) + frame('ping', {}))).toEqual([]);
  });
});

describe('token store', () => {
  it('round-trips a token', () => {
    const backing = new Map<string, string>();
    const store = new TokenStore({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => void backing.set(k, v),
    });
    store.write('abc');
    expect(store.read()).toBe('abc');
  });

  it('forgets rather than throwing when storage is refused', () => {
    // Safari in private mode throws on access. A widget that crashes on a
    // privacy setting is worse than one that forgets a conversation, and
    // forgetting is the right failure — the token only unlocks its own history.
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = new TokenStore(hostile);
    expect(() => store.write('abc')).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('works with no storage at all', () => {
    const store = new TokenStore(null);
    expect(() => store.write('abc')).not.toThrow();
    expect(store.read()).toBeNull();
  });
});

describe('request body', () => {
  it('omits the token entirely on a first turn', () => {
    expect(JSON.parse(requestBody('pk_dev_1886', 'hi', 'en', null))).toEqual({
      widgetKey: 'pk_dev_1886',
      text: 'hi',
      locale: 'en',
    });
  });

  it('sends the token back once there is one', () => {
    expect(JSON.parse(requestBody('pk_dev_1886', 'hi', 'ar', 'abc')).token).toBe('abc');
  });
});

describe('language', () => {
  it('follows the page, not the browser', () => {
    // A Saudi storefront served in English stays in English: the merchant
    // chose the page's language and the widget is part of the page.
    expect(langFromDocument('ar')).toBe('ar');
    expect(langFromDocument('ar-SA')).toBe('ar');
    expect(langFromDocument('en-GB')).toBe('en');
    expect(langFromDocument('')).toBe('en');
    expect(langFromDocument('AR-sa')).toBe('ar');
  });
});

describe('citations', () => {
  it('renders only sources that have somewhere to go', () => {
    expect(
      linkableSources([
        { title: 'Refund policy', url: 'https://x.test/a' },
        { title: 'Something uploaded', url: null },
        { title: 'Empty', url: '' },
      ]),
    ).toEqual([{ title: 'Refund policy', url: 'https://x.test/a' }]);
  });
});
