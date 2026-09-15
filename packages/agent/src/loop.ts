import { ToolLoopAgent, isStepCount, type ModelMessage } from 'ai';
import type { Channel, Language, Logger, TenantId } from '@bitc/core';
import { estimateCostUsd, providerOptionsFor, type ChatModelHandle } from '@bitc/models';
import type { ShopifyReadClient } from '@bitc/shopify';
import type { TenantRuntimeConfig, TurnContext, TurnRecorder } from './context.ts';
import { escalate } from './escalation.ts';
import { checkCitations, sourcesFromToolCalls, type CitationVerdict } from './guard/citations.ts';
import { checkGrounding, type GroundingVerdict } from './guard/grounding.ts';
import type { GapRecorder, KnowledgeSearcher } from './knowledge/types.ts';
import { detectLanguage } from './lang/detect.ts';
import {
  getOrCreateConversation,
  loadHistory,
  persistTurn,
  tokensUsedToday,
  type TurnUsage,
} from './persistence.ts';
import { systemMessage } from './prompt/messages.ts';
import { renderSystemPrompt } from './prompt/template.ts';
import { loadTenantConfig } from './tenant.ts';
import { makeTools } from './tools/index.ts';

export const MAX_TOOL_STEPS = 5;

export interface TurnInput {
  tenantId: TenantId;
  channel: Channel;
  externalConversationId: string;
  text: string;
  ipHash?: string;
  localeHint?: Language;
}

export interface TurnDeps {
  chat: ChatModelHandle;
  shopify: ShopifyReadClient;
  knowledge: KnowledgeSearcher;
  /**
   * Harness-only. Lets an experiment vary one config value across runs without
   * editing the tenant, so an A/B is a flag rather than a migration. Nothing
   * in production sets this.
   */
  configOverrides?: Partial<TenantRuntimeConfig> | undefined;
  /** Optional. Without it, unanswerable questions go unreported. */
  gaps?: GapRecorder | undefined;
  logger: Logger;
  now?: () => Date;
  /** Wall-clock budget for the model loop. */
  timeoutMs?: number;
  /**
   * Called with each tool's name as it begins. The storefront widget renders
   * these so an eight-second wait describes itself; see
   * docs/adr/0010-no-streaming.md.
   */
  onStage?: ((tool: string) => void) | undefined;
}

export type TurnStatus = 'answered' | 'escalated' | 'suppressed' | 'capped' | 'with_team' | 'error';

export interface TurnResult {
  conversationId: string;
  status: TurnStatus;
  /** Customer-visible text. Null when the thread belongs to the team. */
  reply: string | null;
  lang: Language;
  steps: number;
  usage: TurnUsage;
  latencyMs: number;
  recorder: TurnRecorder;
  grounding: { literal: GroundingVerdict; citations: CitationVerdict } | null;
  rawModelText: string | null;
}

/** Usage arrives as plain numbers or as { total } objects depending on the SDK layer. */
const count = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'total' in value)
    return Number((value as { total?: number }).total ?? 0);
  return 0;
};

const HARD_TOOL_FAILURES = new Set(['tool_error', 'rate_limited']);

/**
 * One customer message in, one reply out. Not retrieve-then-answer: the model
 * chooses tools inside a loop capped at MAX_TOOL_STEPS, and the reply passes
 * both halves of the deterministic grounding gate before anyone sees it.
 */
export const runTurn = async (input: TurnInput, deps: TurnDeps): Promise<TurnResult> => {
  const now = deps.now ?? (() => new Date());
  const started = performance.now();
  const config = { ...(await loadTenantConfig(input.tenantId)), ...(deps.configOverrides ?? {}) };
  const lang = input.localeHint ?? detectLanguage(input.text);
  const conversation = await getOrCreateConversation(
    input.tenantId,
    input.channel,
    input.externalConversationId,
    lang,
  );
  const logger = deps.logger.child({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    channel: input.channel,
  });
  const recorder: TurnRecorder = { toolCalls: [], retrievalHits: [] };
  const ctx: TurnContext = {
    tenantId: input.tenantId,
    conversationId: conversation.id,
    channel: input.channel,
    lang,
    ...(input.ipHash ? { ipHash: input.ipHash } : {}),
    config,
    shopify: deps.shopify,
    knowledge: deps.knowledge,
    gaps: deps.gaps,
    recorder,
    logger,
    now,
    onStage: deps.onStage,
  };
  const zero: TurnUsage = { inputTokens: 0, outputTokens: 0 };

  const finish = async (
    status: TurnStatus,
    reply: string | null,
    extra: {
      usage?: TurnUsage;
      steps?: number;
      grounding?: TurnResult['grounding'];
      rawModelText?: string | null;
      modelKey?: string | null;
    } = {},
  ): Promise<TurnResult> => {
    const usage = extra.usage ?? zero;
    const latencyMs = Math.round(performance.now() - started);
    const modelKey = extra.modelKey ?? null;
    await persistTurn({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      channel: input.channel,
      lang,
      userText: input.text,
      reply,
      modelKey,
      usage,
      latencyMs,
      recorder,
      grounding: extra.grounding
        ? { ...extra.grounding, rawModelText: extra.rawModelText ?? null, status }
        : { status },
      costUsd: modelKey ? estimateCostUsd(modelKey, usage) : null,
      now: now(),
    });
    logger.info('turn', {
      status,
      steps: extra.steps ?? 0,
      latencyMs,
      ...usage,
      tools: recorder.toolCalls.map((t) => t.name),
    });
    return {
      conversationId: conversation.id,
      status,
      reply,
      lang,
      steps: extra.steps ?? 0,
      usage,
      latencyMs,
      recorder,
      grounding: extra.grounding ?? null,
      rawModelText: extra.rawModelText ?? null,
    };
  };

  // Section 8: once escalated, the thread belongs to a human until resolved.
  if (conversation.status === 'escalated') return finish('with_team', null);

  // Section 11 / ADR 0008: caps are checked before any model call.
  if (
    conversation.turnCount >= config.maxTurnsPerConversation ||
    conversation.tokenTotal >= config.maxTokensPerConversation
  ) {
    await escalate(ctx, {
      reason: 'conversation_cap',
      summary: 'Conversation reached its turn or token cap.',
    });
    return finish('escalated', systemMessage('conversation_cap', lang, config.messages));
  }
  const usedToday = await tokensUsedToday(input.tenantId, now());
  if (usedToday >= config.maxTokensPerDay) {
    logger.warn('daily token cap reached', { usedToday, cap: config.maxTokensPerDay });
    return finish('capped', systemMessage('daily_cap', lang, config.messages));
  }
  if (usedToday >= (config.maxTokensPerDay * config.usageAlertPct) / 100) {
    logger.warn('daily token usage above alert threshold', {
      usedToday,
      cap: config.maxTokensPerDay,
      pct: config.usageAlertPct,
    });
  }

  const history = await loadHistory(input.tenantId, conversation.id);
  const messages: ModelMessage[] = [...history, { role: 'user', content: input.text }];
  const tools = makeTools(ctx);

  const agent = new ToolLoopAgent({
    model: deps.chat.model,
    instructions: renderSystemPrompt({
      brand_name: config.brandName,
      brand_description: config.brandDescription,
      brand_voice: config.brandVoice,
    }),
    tools,
    stopWhen: isStepCount(MAX_TOOL_STEPS),
    temperature: 0.2,
    maxOutputTokens: Math.min(1024, deps.chat.spec.maxOutputTokens),
    providerOptions: providerOptionsFor(deps.chat.spec),
  });

  let text: string;
  let steps = 0;
  let usage: TurnUsage;
  let finishReason: string;
  try {
    const result = await agent.generate({ messages, timeout: deps.timeoutMs ?? 45_000 });
    text = result.text;
    steps = result.steps.length;
    usage = {
      inputTokens: count(result.totalUsage.inputTokens),
      outputTokens: count(result.totalUsage.outputTokens),
    };
    finishReason = result.finishReason;
  } catch (error) {
    logger.error('model call failed', { error });
    // The model already handed the thread over before failing; that stands.
    if (recorder.escalation) {
      return finish('escalated', systemMessage('escalated', lang, config.messages), {
        steps,
        modelKey: deps.chat.spec.key,
      });
    }
    await escalate(ctx, {
      reason: 'system_error',
      summary: 'The assistant could not complete the reply.',
    });
    return finish('error', systemMessage('error', lang, config.messages), {
      steps,
      modelKey: deps.chat.spec.key,
    });
  }
  const modelKey = deps.chat.spec.key;

  // A tool the model needed failed outright. Say so plainly, do not improvise.
  const hardFailure = recorder.toolCalls.find(
    (t) =>
      !t.ok &&
      HARD_TOOL_FAILURES.has((t.output as { error?: { code?: string } }).error?.code ?? ''),
  );
  if (hardFailure) {
    await escalate(ctx, {
      reason: 'tool_failure',
      summary: `${hardFailure.name} failed for the customer's request.`,
    });
    return finish('escalated', systemMessage('escalated', lang, config.messages), {
      usage,
      steps,
      modelKey,
      rawModelText: text,
    });
  }

  // Ran out of steps still wanting tools: the loop could not converge.
  if (finishReason === 'tool-calls' || (steps >= MAX_TOOL_STEPS && !text.trim())) {
    await escalate(ctx, {
      reason: 'step_limit',
      summary: 'The assistant could not resolve the request within its tool budget.',
    });
    return finish('escalated', systemMessage('escalated', lang, config.messages), {
      usage,
      steps,
      modelKey,
      rawModelText: text,
    });
  }

  // Both halves of the deterministic gate. ADR 0005.
  const literal = checkGrounding({
    reply: text,
    toolResults: recorder.toolCalls.map((t) => t.output),
    toolsCalled: recorder.toolCalls.map((t) => t.name),
    alwaysGrounded: [config.brandName],
  });
  const citations = checkCitations({
    reply: text,
    sources: sourcesFromToolCalls(recorder.toolCalls),
    customerText: input.text,
  });
  const grounding = { literal, citations };

  // Escalation copy is system copy. The model's prose after handing over adds
  // nothing a customer needs and can add a promise; it is kept for audit only.
  if (recorder.escalation) {
    return finish('escalated', systemMessage('escalated', lang, config.messages), {
      usage,
      steps,
      modelKey,
      grounding,
      rawModelText: text,
    });
  }

  if (!literal.ok || !citations.ok) {
    logger.warn('reply suppressed by grounding gate', {
      literal: literal.misses,
      citations: citations.misses,
    });
    await escalate(ctx, {
      reason: 'grounding_failure',
      summary: `Reply withheld: ${[...literal.misses.map((m) => `${m.kind} ${m.value}`), ...citations.misses.map((m) => `${m.reason}: ${m.sentence.slice(0, 80)}`)].join('; ')}`,
    });
    return finish('suppressed', systemMessage('suppressed', lang, config.messages), {
      usage,
      steps,
      modelKey,
      grounding,
      rawModelText: text,
    });
  }

  const reply = citations.cleanReply || systemMessage('escalated', lang, config.messages);
  return finish('answered', reply, { usage, steps, modelKey, grounding, rawModelText: text });
};
