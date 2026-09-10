import type { Channel, Language, Logger, TenantId } from '@bitc/core';
import type { ShopifyReadClient } from '@bitc/shopify';
import type { GapRecorder, KnowledgeSearcher } from './knowledge/types.ts';

export interface ShippingRule {
  country: string;
  label: string;
  carrier: string;
  range: string;
  cost: string;
}

export interface LookupLimits {
  perConversation: number;
  perIpPerHour: number;
}

/** tenant_config, loaded once per turn and treated as read-only. */
export interface TenantRuntimeConfig {
  tenantId: TenantId;
  brandName: string;
  brandDescription: string;
  brandVoice: string;
  languages: Language[];
  chatModel: string;
  embeddingModel: string;
  reranker: string;
  productionChatModel: string | null;
  escalationEmails: string[];
  retrievalMinScore: number;
  maxTokensPerConversation: number;
  maxTurnsPerConversation: number;
  maxTokensPerDay: number;
  usageAlertPct: number;
  maxEscalationsPerHour: number;
  shipping: ShippingRule[];
  lookupLimits: LookupLimits;
  messages: Partial<Record<Language, Partial<Record<string, string>>>> | undefined;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  latencyMs: number;
}

export interface RetrievalHitRecord {
  chunkId: string;
  score: number;
  url: string | null;
}

export interface EscalationRecord {
  id: string;
  reason: string;
  summary: string;
  deliveryStatus: 'pending' | 'digested';
}

/** Everything a turn produced, written by tools and read by the gates. */
export interface TurnRecorder {
  toolCalls: ToolCallRecord[];
  retrievalHits: RetrievalHitRecord[];
  escalation?: EscalationRecord;
}

export interface TurnContext {
  tenantId: TenantId;
  conversationId: string;
  channel: Channel;
  lang: Language;
  /** Blind index of the caller's IP, if the channel has one. */
  ipHash?: string;
  config: TenantRuntimeConfig;
  shopify: ShopifyReadClient;
  knowledge: KnowledgeSearcher;
  /** Optional: without it, unanswerable questions are simply not reported. */
  gaps?: GapRecorder | undefined;
  recorder: TurnRecorder;
  logger: Logger;
  now: () => Date;
}

/** Every tool answers in this shape. Errors are values the model can read, not exceptions. */
export type ToolResult<T> =
  ({ ok: true } & T) | { ok: false; error: { code: string; message: string } };

export const toolError = (
  code: string,
  message: string,
): { ok: false; error: { code: string; message: string } } => ({
  ok: false,
  error: { code, message },
});

/** Wraps a tool body so every call lands in the recorder with timing. */
export const recorded = async <I, O extends { ok: boolean }>(
  ctx: TurnContext,
  name: string,
  input: I,
  run: () => Promise<O>,
): Promise<O> => {
  const started = performance.now();
  let output: O;
  try {
    output = await run();
  } catch (error) {
    ctx.logger.error('tool threw', { tool: name, error });
    output = toolError(
      'tool_error',
      'The store system did not respond. Please escalate.',
    ) as unknown as O;
  }
  ctx.recorder.toolCalls.push({
    name,
    input,
    output,
    ok: output.ok,
    latencyMs: Math.round(performance.now() - started),
  });
  return output;
};
