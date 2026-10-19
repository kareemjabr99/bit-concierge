import type { JobWithMetadata } from 'pg-boss';
import { ConfigError, JOBS, createLogger, readEnv, type JobPayloads } from '@bitc/core';
import { assertAppRole, disconnect } from '@bitc/db';
import { connectQueue } from '@bitc/db/queue';
import { createResendSender } from './email/resend.ts';
import { deliverDigest, deliverEscalation } from './jobs/escalation-email.ts';

/**
 * The queue consumer. One process, never scaled to zero (ADR 0001): a
 * suspended worker looks exactly like email that silently stopped.
 *
 * Connects as the application role, so every job reads tenant rows through
 * withTenant() and row-level security, the same as a customer's turn does.
 */

const base = readEnv('base');
const logger = createLogger({ level: base.LOG_LEVEL });
await assertAppRole();

const { boss, stop } = await connectQueue(base.DATABASE_URL, { role: 'worker' });

/** pg-boss counts retries from zero; the attempt after the last retry is final. */
const isFinal = (job: JobWithMetadata<unknown>): boolean => job.retryCount >= job.retryLimit;

/**
 * Without a provider key the email jobs are not consumed at all. They wait in
 * the queue (pg-boss keeps a queued job for 14 days) and the rows stay
 * `pending`, which is the truth: nothing was sent. In production that is a
 * misconfiguration, so the worker refuses to start rather than run without it.
 */
let email: ReturnType<typeof readEnv<'email'>> | undefined;
try {
  email = readEnv('email');
} catch (error) {
  if (base.NODE_ENV === 'production') throw error;
  logger.warn('escalation email not configured; escalation jobs will wait in the queue', {
    detail: error instanceof ConfigError ? error.message : String(error),
  });
}

if (email) {
  const sender = createResendSender({
    apiKey: email.RESEND_API_KEY,
    from: email.ESCALATION_FROM_EMAIL,
  });
  const deps = { sender, logger };

  await boss.work(
    JOBS.escalationEmail,
    { includeMetadata: true, batchSize: 1 },
    async ([job]: JobWithMetadata<JobPayloads['escalation-email']>[]) => {
      if (!job) return;
      await deliverEscalation(deps, job.data, { final: isFinal(job) });
    },
  );
  await boss.work(
    JOBS.escalationDigest,
    { includeMetadata: true, batchSize: 1 },
    async ([job]: JobWithMetadata<JobPayloads['escalation-digest']>[]) => {
      if (!job) return;
      await deliverDigest(deps, job.data, { final: isFinal(job) });
    },
  );
}

logger.info('worker started', { email: email !== undefined });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stop()
      .then(() => disconnect())
      .then(() => process.exit(0));
  });
}
