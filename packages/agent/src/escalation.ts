import { and, eq, gte, sql } from 'drizzle-orm';
import { stripStatusUrls } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { EscalationRecord, TurnContext } from './context.ts';

export interface EscalationRequest {
  reason: string;
  summary: string;
  contact?:
    | { name?: string | undefined; email?: string | undefined; phone?: string | undefined }
    | undefined;
}

/**
 * Writes the escalation, marks the conversation, and records it on the turn.
 * Above the tenant's hourly cap the row is marked `digested` rather than
 * dropped; the digest email itself is assembled by the worker (Phase 4/6).
 * Email sending is not wired in Phase 1 — the row is the contract.
 */
export const escalate = async (
  ctx: TurnContext,
  request: EscalationRequest,
): Promise<EscalationRecord> => {
  if (ctx.recorder.escalation) return ctx.recorder.escalation;

  // The row is what the escalation email is built from, so what is not in the
  // row cannot be in the email. An order's status URL opens the order without
  // a login; the team has the order number and admin, and does not need the
  // customer's key. The summary is the model's text — or, when a reply is
  // withheld, a quote of the literal that failed the gate, which can be exactly
  // this URL. Stripped here, at the one write, rather than trusted upstream.
  request = {
    ...request,
    reason: stripStatusUrls(request.reason),
    summary: stripStatusUrls(request.summary),
  };

  const since = new Date(ctx.now().getTime() - 60 * 60 * 1000);
  const record = await withTenant(ctx.tenantId, async (tx) => {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.escalations)
      .where(
        and(
          eq(schema.escalations.tenantId, ctx.tenantId),
          gte(schema.escalations.createdAt, since),
        ),
      );
    const deliveryStatus =
      (recent?.n ?? 0) >= ctx.config.maxEscalationsPerHour ? 'digested' : 'pending';

    const [row] = await tx
      .insert(schema.escalations)
      .values({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        reason: request.reason,
        summary: request.summary,
        contact: request.contact ?? null,
        sentTo: ctx.config.escalationEmails,
        deliveryStatus,
      })
      .returning({ id: schema.escalations.id });

    await tx
      .update(schema.conversations)
      .set({ status: 'escalated', outcome: 'escalated' })
      .where(eq(schema.conversations.id, ctx.conversationId));

    return {
      id: row!.id,
      reason: request.reason,
      summary: request.summary,
      deliveryStatus,
    } as EscalationRecord;
  });

  ctx.recorder.escalation = record;
  ctx.logger.info('escalated', { reason: request.reason, deliveryStatus: record.deliveryStatus });
  return record;
};
