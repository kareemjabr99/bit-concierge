import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { asTenantId, stripStatusUrls, type Logger } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import { EmailRejected, type EmailSender } from '../email/sender.ts';

/**
 * Escalation email: the row is the contract, and this turns it into a message.
 *
 * `escalate()` writes the row and enqueues a job naming it, in one
 * transaction. Here the row is read under the tenant's scope, locked, sent and
 * marked, also in one transaction, so two deliveries of the same job (pg-boss
 * is at-least-once) cannot both send: the second waits on the lock and then
 * finds the row already `sent`. The provider's idempotency key covers the
 * remaining gap, a send that succeeded whose answer was lost.
 *
 * The transaction is held open across one HTTP call. At one tenant and a cap
 * of twenty escalations an hour that is a few seconds of one connection; it
 * is the price of the lock, and cheaper than a status the schema does not have.
 *
 * Outcomes are terminal or retried, never quietly dropped: `sent`, `failed`
 * (the provider refused it, or the queue's last attempt failed), or a thrown
 * error the queue retries with the row untouched and still `pending`.
 *
 * What leaves the system: the reason, the assistant's summary, and the contact
 * details the customer typed — personal data, sent to Resend as a
 * sub-processor (ADR 0007; agreement-inputs.md lists it). Order status links
 * are stripped again here: ADR 0012 requires it of anything that forwards
 * text, and the write-time strip is not something to rely on from a distance.
 */

export interface DeliveryDeps {
  sender: EmailSender;
  logger: Logger;
  now?: () => Date;
}

export interface Attempt {
  /** The queue will not retry after this one. */
  final: boolean;
}

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped' | 'missing' | 'empty';

interface Contact {
  name?: string;
  email?: string;
  phone?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? stripStatusUrls(value).trim() : '';

const contactLines = (contact: unknown): string[] => {
  const c = (contact ?? {}) as Contact;
  const lines = [
    ['Name', clean(c.name)],
    ['Email', clean(c.email)],
    ['Phone', clean(c.phone)],
  ]
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return lines.length > 0 ? lines : ['(none given in the chat)'];
};

const when = (d: Date): string => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * The message for one escalation. Our copy, addressed to the merchant's team,
 * never to a customer; plain text so nothing in a summary can render as markup.
 */
export const escalationMessage = (
  brand: string,
  row: {
    id: string;
    conversationId: string;
    reason: string;
    summary: string | null;
    contact: unknown;
    createdAt: Date;
  },
): { subject: string; text: string } => {
  const reason = clean(row.reason) || 'unspecified';
  return {
    subject: `[${brand}] A customer needs a person: ${reason}`,
    text: [
      `A conversation on the ${brand} assistant was handed to your team.`,
      '',
      `Reason: ${reason}`,
      `When: ${when(row.createdAt)}`,
      `Conversation: ${row.conversationId}`,
      `Escalation: ${row.id}`,
      '',
      'What the assistant noted:',
      clean(row.summary) || '(no summary)',
      '',
      'Customer contact, as given in the chat:',
      ...contactLines(row.contact),
      '',
      'Reply to the customer through your usual channel. Nobody reads replies to this address.',
    ].join('\n'),
  };
};

const brandOf = async (
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
): Promise<string> => {
  const [config] = await tx
    .select({ brand: schema.tenantConfig.brandName })
    .from(schema.tenantConfig)
    .where(eq(schema.tenantConfig.tenantId, tenantId));
  return config?.brand ?? 'Store';
};

export const deliverEscalation = async (
  deps: DeliveryDeps,
  job: { tenantId: string; escalationId: string },
  attempt: Attempt,
): Promise<DeliveryOutcome> => {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger.child({ tenantId: job.tenantId, escalationId: job.escalationId });

  return withTenant(asTenantId(job.tenantId), async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.escalations)
      .where(eq(schema.escalations.id, job.escalationId))
      .for('update');

    if (!row) {
      // Deleted since (a tenant offboarded, retention), or a job from a
      // different database. Nothing to send and nothing to mark.
      log.warn('escalation_email_row_missing');
      return 'missing';
    }
    if (row.deliveryStatus !== 'pending') return 'skipped';

    const markFailed = async (why: string): Promise<'failed'> => {
      await tx
        .update(schema.escalations)
        .set({ deliveryStatus: 'failed' })
        .where(eq(schema.escalations.id, row.id));
      log.error('escalation_email_failed', { why });
      return 'failed';
    };

    // The recipients were fixed when the row was written. An empty list is a
    // tenant with no escalation address configured: a fact about the tenant,
    // and one nobody will find unless the row says so.
    if (row.sentTo.length === 0) return markFailed('no escalation address configured');

    const message = escalationMessage(await brandOf(tx, job.tenantId), row);
    try {
      await deps.sender.send({
        to: row.sentTo,
        ...message,
        idempotencyKey: `escalation-${row.id}`,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (error instanceof EmailRejected || attempt.final) return markFailed(why);
      // Rolls back to `pending`; the queue tries again with backoff.
      log.warn('escalation_email_retrying', { why });
      throw error;
    }

    await tx
      .update(schema.escalations)
      .set({ deliveryStatus: 'sent', sentAt: now() })
      .where(eq(schema.escalations.id, row.id));
    log.info('escalation_email_sent', { recipients: row.sentTo.length });
    return 'sent';
  });
};

/**
 * Every escalation over the tenant's hourly cap since the last digest, in one
 * message. Over the cap is when something is going wrong at volume, and one
 * email per customer is exactly the flood the cap exists to prevent.
 *
 * The idempotency key is a hash of the escalation ids it covers, not of the
 * digest row: the row is created inside this transaction and rolls back with
 * a failed attempt, so its id changes on retry and would key nothing.
 */
export const deliverDigest = async (
  deps: DeliveryDeps,
  job: { tenantId: string },
  attempt: Attempt,
): Promise<DeliveryOutcome> => {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger.child({ tenantId: job.tenantId });

  return withTenant(asTenantId(job.tenantId), async (tx) => {
    const rows = await tx
      .select()
      .from(schema.escalations)
      .where(
        and(eq(schema.escalations.deliveryStatus, 'digested'), isNull(schema.escalations.digestId)),
      )
      .orderBy(asc(schema.escalations.createdAt))
      .for('update');
    if (rows.length === 0) return 'empty';

    const ids = rows.map((r) => r.id);
    const recipients = [...new Set(rows.flatMap((r) => r.sentTo))];

    const markFailed = async (why: string): Promise<'failed'> => {
      await tx
        .update(schema.escalations)
        .set({ deliveryStatus: 'failed' })
        .where(inArray(schema.escalations.id, ids));
      log.error('escalation_digest_failed', { why, escalations: ids.length });
      return 'failed';
    };
    if (recipients.length === 0) return markFailed('no escalation address configured');

    const brand = await brandOf(tx, job.tenantId);
    const text = [
      `${rows.length} conversations on the ${brand} assistant were handed to your team after the`,
      'hourly limit for individual emails was reached. They are listed together here so that a',
      'busy hour does not become a flood of messages.',
      '',
      ...rows.flatMap((r, i) => [
        `${i + 1}. ${clean(r.reason) || 'unspecified'} · ${when(r.createdAt)} · conversation ${r.conversationId}`,
        `   ${(clean(r.summary) || '(no summary)').replace(/\n/g, '\n   ')}`,
        `   Contact: ${contactLines(r.contact).join(' · ')}`,
        '',
      ]),
      'Reply to customers through your usual channel. Nobody reads replies to this address.',
    ].join('\n');

    const [digest] = await tx
      .insert(schema.escalationDigests)
      .values({ tenantId: job.tenantId, escalationCount: rows.length, sentTo: recipients })
      .returning({ id: schema.escalationDigests.id });

    try {
      await deps.sender.send({
        to: recipients,
        subject: `[${brand}] ${rows.length} customers need a person (hourly digest)`,
        text,
        idempotencyKey: `digest-${createHash('sha256')
          .update([...ids].sort().join(','))
          .digest('hex')}`,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (error instanceof EmailRejected || attempt.final) {
        await tx
          .delete(schema.escalationDigests)
          .where(eq(schema.escalationDigests.id, digest!.id));
        return markFailed(why);
      }
      log.warn('escalation_digest_retrying', { why });
      throw error;
    }

    await tx
      .update(schema.escalationDigests)
      .set({ sentAt: now() })
      .where(eq(schema.escalationDigests.id, digest!.id));
    await tx
      .update(schema.escalations)
      .set({ digestId: digest!.id })
      .where(inArray(schema.escalations.id, ids));
    log.info('escalation_digest_sent', { escalations: rows.length });
    return 'sent';
  });
};
