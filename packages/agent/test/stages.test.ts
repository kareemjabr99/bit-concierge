import { describe, expect, it } from 'vitest';
import { createLogger } from '@bitc/core';
import { recorded, type TurnContext } from '../src/context.ts';
import { stageLabel, STAGE_LABELS } from '../src/prompt/messages.ts';

/**
 * Stages exist because the reply cannot stream — see
 * docs/adr/0010-no-streaming.md — so the wait has to describe itself instead.
 * Which means a stage has exactly two obligations: it must be true, and it
 * must arrive while the work is happening.
 */

const context = (onStage?: (tool: string) => void): TurnContext =>
  ({
    recorder: { toolCalls: [], retrievalHits: [] },
    logger: createLogger({ level: 'error', write: () => {} }),
    onStage,
  }) as unknown as TurnContext;

describe('stages are announced while the work happens', () => {
  it('fires before the tool body runs, not after', async () => {
    // The whole point. Announced afterwards, "Looking up your order" appears
    // once the lookup is already done, which is a log line rather than
    // progress — and on a slow tool the customer watches nothing for the
    // entire time it mattered.
    const order: string[] = [];
    const ctx = context((tool) => order.push(`stage:${tool}`));
    await recorded(ctx, 'lookup_order', {}, async () => {
      order.push('work');
      return { ok: true as const };
    });
    expect(order).toEqual(['stage:lookup_order', 'work']);
  });

  it('fires even when the tool then fails', async () => {
    // A customer who was told "checking your order" and then gets a hand-over
    // has been told the truth about both.
    const seen: string[] = [];
    const ctx = context((tool) => seen.push(tool));
    await recorded(ctx, 'lookup_order', {}, async () => {
      throw new Error('shopify is down');
    });
    expect(seen).toEqual(['lookup_order']);
    expect(ctx.recorder.toolCalls[0]!.ok).toBe(false);
  });

  it('is optional — a caller that wants no stages still records the call', async () => {
    const ctx = context(undefined);
    await recorded(ctx, 'search_knowledge', {}, async () => ({ ok: true as const }));
    expect(ctx.recorder.toolCalls).toHaveLength(1);
  });

  it('announces every tool that runs, once per call', async () => {
    const seen: string[] = [];
    const ctx = context((tool) => seen.push(tool));
    for (const tool of ['search_knowledge', 'search_knowledge', 'lookup_order']) {
      await recorded(ctx, tool, {}, async () => ({ ok: true as const }));
    }
    // Collapsing repeats is the transport's job, not the loop's: the loop
    // reports what happened, and what happened was two searches.
    expect(seen).toEqual(['search_knowledge', 'search_knowledge', 'lookup_order']);
  });
});

describe('stage labels', () => {
  it('covers every tool the agent can call', async () => {
    const { makeTools } = await import('../src/tools/index.ts');
    const tools = Object.keys(makeTools({} as unknown as TurnContext));
    for (const tool of tools) {
      expect(stageLabel(tool, 'en'), `no English stage label for ${tool}`).not.toBeNull();
      expect(stageLabel(tool, 'ar'), `no Arabic stage label for ${tool}`).not.toBeNull();
    }
  });

  it('describes the action, never the result', () => {
    // "Found your order" would be a claim about an answer that has not been
    // through the gate. Every label has to be safe to say the instant the tool
    // is called and still true if it returns nothing.
    const claimsAResult = /\b(found|here (is|are)|your order is|we have|in stock|available)\b/i;
    for (const [lang, labels] of Object.entries(STAGE_LABELS)) {
      for (const [tool, label] of Object.entries(labels)) {
        expect(claimsAResult.test(label), `${lang}/${tool} claims a result: "${label}"`).toBe(
          false,
        );
      }
    }
  });

  it('returns nothing for a tool it does not know', () => {
    expect(stageLabel('some_future_tool', 'en')).toBeNull();
  });

  it('is readable in the source, not escaped', () => {
    // A Phase 5 native reviewer has to be able to read the Arabic to review it.
    expect(Object.values(STAGE_LABELS.ar).join('')).toMatch(/[؀-ۿ]/);
  });
});
