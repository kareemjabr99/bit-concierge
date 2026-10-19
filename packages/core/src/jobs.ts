/**
 * The jobs the web process hands the worker, and what each one carries.
 *
 * **Ids only.** A payload names a tenant and a row; the job reads the row
 * under `withTenant()`. The queue lives in the same database but outside
 * row-level security (migration 0008), so a payload that carried customer
 * text would be tenant data with no policy on it. It would also outlive the
 * row: ADR 0007's retention applies to job payloads too, and the cheapest way
 * to honour it is to have nothing in them to retain.
 *
 * No pg-boss types here. Everything that enqueues — the agent, the webhook
 * receiver — depends on this interface; only `@bitc/db/queue` and the worker
 * know what is behind it.
 */

export const JOBS = {
  /** One escalation row, emailed to the addresses the row names. */
  escalationEmail: 'escalation-email',
  /** Every escalation above the hourly cap since the last digest, in one email. */
  escalationDigest: 'escalation-digest',
  /** A product changed in the store; refresh what retrieval knows about it. */
  productChanged: 'product-changed',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface JobPayloads {
  'escalation-email': { tenantId: string; escalationId: string };
  'escalation-digest': { tenantId: string };
  'product-changed': { tenantId: string; productGid: string; topic: string };
}

export interface EnqueueOptions {
  /** Do not start before this many seconds from now. */
  startAfterSeconds?: number;
  /** At most one queued job per key per `singletonSeconds` window. */
  singletonKey?: string;
  singletonSeconds?: number;
  /**
   * The open database transaction to enqueue in, so the job commits if and
   * only if the row it points at does. Typed loosely because this package
   * knows nothing of the database; `@bitc/db/queue` takes a Drizzle
   * transaction here.
   */
  transaction?: unknown;
}

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<void>;
}
