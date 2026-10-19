import { BitcError } from '@bitc/core';

export interface OutgoingEmail {
  to: string[];
  subject: string;
  text: string;
  /**
   * The same key for every attempt at the same message. A send that succeeded
   * at the provider but whose response was lost is retried by the queue; the
   * key is what stops the merchant getting it twice.
   */
  idempotencyKey: string;
}

export interface EmailSender {
  send(message: OutgoingEmail): Promise<{ id: string }>;
}

/**
 * The provider refused the message and will refuse it again: a bad key, an
 * unverified sending domain, a malformed address. Retrying for an hour only
 * delays the row being marked `failed`, where someone will look at it.
 */
export class EmailRejected extends BitcError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('email_rejected', message, { context });
    this.name = 'EmailRejected';
  }
}
