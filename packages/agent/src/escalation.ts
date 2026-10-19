import { and, eq, gte, sql } from 'drizzle-orm';
import { JOBS, stripStatusUrls } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { EscalationRecord, TurnContext } from './context.ts';

export interface EscalationRequest {
  reason: string;
  summary: string;
  contact?:
    | { name?: string | undefined; email?: string | undefined; phone?: string | undefined }
    | undefined;
}

/** One digest per tenant per hour, sent when the hour is out. */
const DIGEST_WINDOW_SECONDS = 60 * 60;

/**
 * Writes the escalation, marks the conversation, and records it on the turn.
 * Above the tenant's hourly cap the row is marked `digested` rather than
 * dropped, and the worker sends one digest for the hour instead.
 *
 * The row is the contract; the email is built from it by the worker
 * (apps/worker/src/jobs/escalation-email.ts). The job that tells the worker is
 * enqueued in the same transaction, so a row is never written without its job
 * or a job without its row — but in a savepoint, so a queue that is down
 * costs the email, never the escalation. The row then stays `pending`, which
 * is true.
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

    const jobs = ctx.jobs;
    if (jobs) {
      try {
        await tx.transaction(async (savepoint) => {
          if (deliveryStatus === 'pending') {
            await jobs.enqueue(
              JOBS.escalationEmail,
              { tenantId: ctx.tenantId, escalationId: row!.id },
              { transaction: savepoint },
            );
          } else {
            await jobs.enqueue(
              JOBS.escalationDigest,
              { tenantId: ctx.tenantId },
              {
                transaction: savepoint,
                singletonKey: ctx.tenantId,
                singletonSeconds: DIGEST_WINDOW_SECONDS,
                startAfterSeconds: DIGEST_WINDOW_SECONDS,
              },
            );
          }
        });
      } catch (error) {
        ctx.logger.error('escalation_enqueue_failed', {
          escalationId: row!.id,
          deliveryStatus,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
