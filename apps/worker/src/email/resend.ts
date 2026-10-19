import { BitcError } from '@bitc/core';
import { EmailRejected, type EmailSender } from './sender.ts';

/**
 * Resend's send endpoint over plain fetch — one POST does not justify an SDK
 * and its dependency tree under the supply-chain policy (ADR 0009).
 *
 * Checked against Resend's docs on 2026-10-18:
 *   https://resend.com/docs/api-reference/emails/send-email
 *   https://resend.com/docs/api-reference/errors
 *
 * - `Authorization: Bearer <key>`; body `from`, `to` (up to 50), `subject`,
 *   `text`. Answers `{ id }`.
 * - `Idempotency-Key` header, kept 24 hours, at most 256 characters.
 * - Retryable: 429 (rate limit and quotas), 500, 503, and the two 409s that
 *   mean "another request is in flight". Not retryable: 400, 401, 403, 404,
 *   405, 422, and 409 `invalid_idempotent_request` (same key, different
 *   body — a bug here, not a busy provider).
 */

const ENDPOINT = 'https://api.resend.com/emails';
const RETRYABLE_409 = new Set(['concurrent_idempotent_requests', 'resource_locked']);

export const createResendSender = (options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender => {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return {
    send: async (message) => {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as { id?: string };
        if (!body.id) {
          // A 2xx without an id is not a confirmed send. Retry; the
          // idempotency key makes that safe if it did go out.
          throw new BitcError('email_unconfirmed', 'Resend answered without a message id');
        }
        return { id: body.id };
      }

      // The error body names the problem; the key is never in it, and never
      // in anything thrown from here.
      const body = (await response.json().catch(() => ({}))) as { name?: string; message?: string };
      const detail = `Resend ${response.status} ${body.name ?? ''}: ${body.message ?? ''}`.trim();
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 409 && RETRYABLE_409.has(body.name ?? ''));
      if (retryable) {
        throw new BitcError('email_unavailable', detail, { context: { status: response.status } });
      }
      throw new EmailRejected(detail, { status: response.status, name: body.name });
    },
  };
};
