import { and, desc, eq, sql } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import type { Channel, Language, TenantId } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { TurnRecorder } from './context.ts';

export interface ConversationRow {
  id: string;
  status: string;
  lang: string | null;
  turnCount: number;
  tokenTotal: number;
}

export const getOrCreateConversation = async (
  tenantId: TenantId,
  channel: Channel,
  externalId: string,
  lang: Language,
): Promise<ConversationRow> =>
  withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({
        id: schema.conversations.id,
        status: schema.conversations.status,
        lang: schema.conversations.lang,
        turnCount: schema.conversations.turnCount,
        tokenTotal: schema.conversations.tokenTotal,
      })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.channel, channel),
          eq(schema.conversations.externalId, externalId),
        ),
      );
    if (existing) return existing;
    const [created] = await tx
      .insert(schema.conversations)
      .values({ tenantId, channel, externalId, lang })
      .returning({
        id: schema.conversations.id,
        status: schema.conversations.status,
        lang: schema.conversations.lang,
        turnCount: schema.conversations.turnCount,
        tokenTotal: schema.conversations.tokenTotal,
      });
    return created!;
  });

/**
 * Prior user/assistant text only. Tool calls and results are not replayed:
 * every turn's facts must come from that turn's tools, which is what the
 * grounding gate checks against. The model re-verifies when it needs to.
 */
export const loadHistory = async (
  tenantId: TenantId,
  conversationId: string,
  limit = 20,
): Promise<ModelMessage[]> =>
  withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ role: schema.messages.role, content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);
    return rows
      .reverse()
      .filter((r) => (r.role === 'user' || r.role === 'assistant') && r.content)
      .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content! }));
  });

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface PersistTurnInput {
  tenantId: TenantId;
  conversationId: string;
  channel: Channel;
  lang: Language;
  userText: string;
  /** What the customer sees. Null when the thread is with the team. */
  reply: string | null;
  modelKey: string | null;
  usage: TurnUsage;
  latencyMs: number;
  recorder: TurnRecorder;
  grounding: unknown;
  costUsd: number | null;
  now: Date;
}

export const persistTurn = async (input: PersistTurnInput): Promise<void> => {
  const day = input.now.toISOString().slice(0, 10);
  const total = input.usage.inputTokens + input.usage.outputTokens;

  await withTenant(input.tenantId, async (tx) => {
    await tx.insert(schema.messages).values({
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      role: 'user',
      content: input.userText,
    });
    if (input.reply !== null) {
      await tx.insert(schema.messages).values({
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        role: 'assistant',
        content: input.reply,
        toolCalls: input.recorder.toolCalls,
        retrievalHits: input.recorder.retrievalHits,
        grounding: input.grounding,
        model: input.modelKey,
        promptTokens: input.usage.inputTokens,
        completionTokens: input.usage.outputTokens,
        latencyMs: input.latencyMs,
      });
    }
    await tx
      .update(schema.conversations)
      .set({
        turnCount: sql`${schema.conversations.turnCount} + 1`,
        tokenTotal: sql`${schema.conversations.tokenTotal} + ${total}`,
        lastMessageAt: input.now,
        lang: input.lang,
      })
      .where(eq(schema.conversations.id, input.conversationId));

    await tx
      .insert(schema.usageDaily)
      .values({
        tenantId: input.tenantId,
        day,
        channel: input.channel,
        promptTokens: input.usage.inputTokens,
        completionTokens: input.usage.outputTokens,
        llmCalls: input.modelKey ? 1 : 0,
        escalations: input.recorder.escalation ? 1 : 0,
        modelCostUsd: (input.costUsd ?? 0).toFixed(6),
      })
      .onConflictDoUpdate({
        target: [schema.usageDaily.tenantId, schema.usageDaily.day, schema.usageDaily.channel],
        set: {
          promptTokens: sql`${schema.usageDaily.promptTokens} + ${input.usage.inputTokens}`,
          completionTokens: sql`${schema.usageDaily.completionTokens} + ${input.usage.outputTokens}`,
          llmCalls: sql`${schema.usageDaily.llmCalls} + ${input.modelKey ? 1 : 0}`,
          escalations: sql`${schema.usageDaily.escalations} + ${input.recorder.escalation ? 1 : 0}`,
          modelCostUsd: sql`${schema.usageDaily.modelCostUsd} + ${(input.costUsd ?? 0).toFixed(6)}`,
        },
      });
  });
};

/** Tokens the tenant has used today across channels. One indexed read. */
export const tokensUsedToday = async (tenantId: TenantId, now: Date): Promise<number> =>
  withTenant(tenantId, async (tx) => {
    const day = now.toISOString().slice(0, 10);
    const [row] = await tx
      .select({
        n: sql<number>`coalesce(sum(${schema.usageDaily.promptTokens} + ${schema.usageDaily.completionTokens}), 0)::bigint`,
      })
      .from(schema.usageDaily)
      .where(and(eq(schema.usageDaily.tenantId, tenantId), eq(schema.usageDaily.day, day)));
    return Number(row?.n ?? 0);
  });
