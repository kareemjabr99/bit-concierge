/**
 * The storefront embed.
 *
 * One script tag, a closed shadow root, no dependencies. It runs on a
 * merchant's Shopify theme, which means it runs alongside whatever else that
 * theme loads, and neither side should be able to reach into the other.
 *
 *   <script src="https://…/widget.js" data-bitc-key="pk_live_…" defer></script>
 *
 * The wait is the design problem here. The reply cannot stream — see
 * docs/adr/0010-no-streaming.md — so this spends 3.2s at the median and 8.1s
 * at p95 showing what the agent is actually doing, from stage events the
 * server emits as each tool begins. Never a fake step, never a percentage.
 */

import {
  EventStream,
  langFromDocument,
  linkableSources,
  requestBody,
  TokenStore,
  type Reply,
} from './conversation.ts';

const COPY = {
  en: {
    launcher: 'Chat with us',
    title: 'Ask the store',
    placeholder: 'Ask about an order, sizing or returns',
    send: 'Send',
    close: 'Close chat',
    thinking: 'Working on it',
    failed: 'Something went wrong. Please try again.',
    offline: 'We could not reach the store. Please try again.',
    sources: 'Read more',
  },
  ar: {
    launcher: 'تواصل معنا',
    title: 'اسأل المتجر',
    placeholder: 'اسأل عن طلبك أو المقاسات أو الإرجاع',
    send: 'إرسال',
    close: 'إغلاق المحادثة',
    thinking: 'جاري العمل على طلبك',
    failed: 'صار خلل. حاول مرة ثانية.',
    offline: 'ما قدرنا نتواصل مع المتجر. حاول مرة ثانية.',
    sources: 'اقرأ المزيد',
  },
} as const;

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: inherit; }
  .root {
    position: fixed; inset-inline-end: 20px; inset-block-end: 20px;
    z-index: 2147483000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 15px; line-height: 1.5; color: #14110f;
  }
  .launcher {
    border: 0; border-radius: 999px; padding: 13px 20px;
    background: #14110f; color: #faf8f5; font-size: 15px; font-weight: 500;
    cursor: pointer; box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
  }
  .launcher:focus-visible, button:focus-visible, input:focus-visible, a:focus-visible {
    outline: 2px solid #14110f; outline-offset: 2px;
  }
  .panel {
    display: flex; flex-direction: column;
    width: min(380px, calc(100vw - 32px)); height: min(560px, calc(100vh - 100px));
    background: #faf8f5; border-radius: 14px; overflow: hidden;
    box-shadow: 0 12px 48px rgb(0 0 0 / 0.22);
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; background: #14110f; color: #faf8f5;
  }
  header h2 { margin: 0; font-size: 15px; font-weight: 500; }
  header button { background: none; border: 0; color: inherit; cursor: pointer; padding: 4px; font-size: 18px; }
  .log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 85%; padding: 10px 13px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg.them { background: #fff; border: 1px solid #e8e2da; align-self: flex-start; }
  .msg.you { background: #14110f; color: #faf8f5; align-self: flex-end; }
  .msg.failed { background: #fdf2f2; border-color: #e7c9c9; align-self: flex-start; }
  .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-block-start: 8px; }
  .sources a { font-size: 13px; color: #5b4c3f; text-decoration: underline; }
  .stages { align-self: flex-start; color: #6b6258; font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
  .stage { display: flex; align-items: center; gap: 8px; }
  .stage.done { color: #9a9086; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #14110f; flex: none; }
  .stage.live .dot { animation: pulse 1.1s ease-in-out infinite; }
  .stage.done .dot { background: #c9c0b6; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .stage.live .dot { animation: none; } }
  form { display: flex; gap: 8px; padding: 12px; border-block-start: 1px solid #e8e2da; background: #fff; }
  input {
    flex: 1; border: 1px solid #ddd5cb; border-radius: 9px; padding: 10px 12px;
    font-size: 15px; background: #fff; color: inherit; min-width: 0;
  }
  form button {
    border: 0; border-radius: 9px; padding: 0 16px; background: #14110f;
    color: #faf8f5; font-size: 15px; cursor: pointer;
  }
  form button[disabled] { opacity: 0.45; cursor: default; }
`;

export interface WidgetOptions {
  widgetKey: string;
  endpoint: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  mount?: HTMLElement;
}

export const mountWidget = (options: WidgetOptions): { open: () => void; destroy: () => void } => {
  const lang = langFromDocument(document.documentElement.lang || '');
  const copy = COPY[lang];
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const tokens = new TokenStore(
    options.storage ??
      (() => {
        try {
          return window.localStorage;
        } catch {
          // Safari in private mode throws on access rather than returning null.
          return null;
        }
      })(),
  );

  const host = document.createElement('div');
  // Closed: the merchant's theme cannot reach in and restyle or read this, and
  // `all: initial` on :host stops their CSS leaking the other way. A storefront
  // theme is other people's code running in the same document.
  const shadow = host.attachShadow({ mode: 'closed' });
  const root = document.createElement('div');
  root.className = 'root';
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.append(style, root);
  (options.mount ?? document.body).append(host);

  let panel: HTMLDivElement | null = null;
  let busy = false;

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // textContent, never innerHTML. The reply is the merchant's own policy text
    // returned by a model; treating it as markup would make a store document an
    // injection vector into the storefront.
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const render = (): void => {
    root.replaceChildren();
    if (!panel) {
      const launcher = el('button', 'launcher', copy.launcher);
      launcher.addEventListener('click', open);
      root.append(launcher);
      return;
    }
    root.append(panel);
  };

  const scrollDown = (log: HTMLElement): void => {
    log.scrollTop = log.scrollHeight;
  };

  const open = (): void => {
    panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', copy.title);

    const header = el('header');
    header.append(el('h2', undefined, copy.title));
    const close = el('button', undefined, '×');
    close.setAttribute('aria-label', copy.close);
    close.addEventListener('click', () => {
      panel = null;
      render();
    });
    header.append(close);

    const log = el('div', 'log');
    // Replies arrive whole, so announcing politely is right: a screen reader
    // reads a finished answer rather than a growing one.
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');

    const form = el('form');
    const input = el('input');
    input.placeholder = copy.placeholder;
    input.setAttribute('aria-label', copy.placeholder);
    input.autocomplete = 'off';
    const send = el('button', undefined, copy.send);
    send.type = 'submit';
    form.append(input, send);

    const submit = (): void => {
      const text = input.value.trim();
      if (!text || busy) return;
      input.value = '';
      void ask(text, log, input, send);
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });

    // Enter sends, explicitly.
    //
    // A <form> with a submit button is supposed to give implicit submission
    // for free. Inside this shadow root it does not: removing this handler and
    // pressing Enter does nothing, verified both ways in a real browser. Most
    // people never touch the Send button, so a chat box that ignores Enter is
    // broken for most people — and no unit test would have found it, because
    // the tests dispatch a submit event directly.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    panel.append(header, log, form);
    render();
    input.focus();
  };

  const ask = async (
    text: string,
    log: HTMLElement,
    input: HTMLInputElement,
    send: HTMLButtonElement,
  ): Promise<void> => {
    busy = true;
    send.disabled = true;
    log.append(el('div', 'msg you', text));
    scrollDown(log);

    // The wait, made legible. Stages are appended as the server reports them
    // and the previous one is marked done, so the panel shows a short history
    // of what the agent actually did rather than a single replaced line — on an
    // eight-second turn, a list that grows is the difference between "working"
    // and "stuck".
    const stages = el('div', 'stages');
    const waiting = el('div', 'stage live');
    waiting.append(el('span', 'dot'), el('span', undefined, copy.thinking));
    stages.append(waiting);
    log.append(stages);
    scrollDown(log);

    const addStage = (label: string): void => {
      for (const previous of stages.querySelectorAll('.stage')) {
        previous.className = 'stage done';
      }
      const stage = el('div', 'stage live');
      stage.append(el('span', 'dot'), el('span', undefined, label));
      stages.append(stage);
      scrollDown(log);
    };

    const settle = (reply: Reply | null): void => {
      stages.remove();
      if (!reply) {
        log.append(el('div', 'msg them failed', copy.offline));
      } else {
        tokens.write(reply.token);
        const message = el('div', 'msg them', reply.reply);
        const links = linkableSources(reply.sources);
        if (links.length > 0) {
          const list = el('div', 'sources');
          for (const source of links) {
            const link = el('a', undefined, source.title);
            link.href = source.url;
            link.target = '_blank';
            // The merchant's own domain, but the widget does not get to assume
            // that — these attributes cost nothing and close window.opener.
            link.rel = 'noopener noreferrer';
            list.append(link);
          }
          message.append(list);
        }
        log.append(message);
      }
      scrollDown(log);
      busy = false;
      send.disabled = false;
      input.focus();
    };

    try {
      const response = await doFetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: requestBody(options.widgetKey, text, lang, tokens.read()),
      });

      if (!response.ok || !response.body) {
        settle(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const stream = new EventStream();
      let reply: Reply | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of stream.push(decoder.decode(value, { stream: true }))) {
          if (event.kind === 'stage') addStage(event.label);
          if (event.kind === 'reply') reply = event.reply;
          if (event.kind === 'error') reply = null;
        }
      }
      settle(reply);
    } catch {
      settle(null);
    }
  };

  render();
  return {
    open,
    destroy: () => host.remove(),
  };
};

// Self-mounting when loaded as a script tag. Skipped under a bundler or a test,
// which import mountWidget directly.
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.bitcKey) {
  mountWidget({
    widgetKey: script.dataset.bitcKey,
    endpoint: script.dataset.bitcEndpoint ?? new URL('/api/chat', script.src).toString(),
  });
}
