import { sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle, type DrizzleTransactionLike } from 'pg-boss';
import {
  JOBS,
  type EnqueueOptions,
  type JobName,
  type JobPayloads,
  type JobQueue,
} from '@bitc/core';

/**
 * pg-boss behind the `JobQueue` interface, for the processes that enqueue
 * (the storefront server) and the one that drains (the worker).
 *
 * Connects as the application role. The tables live in the `pgboss` schema,
 * which migration 0008 creates and lets this role build in; pg-boss installs
 * and upgrades its own tables there on start (`createSchema: false`, because
 * the schema is ours).
 *
 * A separate entry point (`@bitc/db/queue`) rather than part of the package
 * root, so the eval runner and the CLI, which never enqueue, do not load it.
 */

export const QUEUE_SCHEMA = 'pgboss';

/**
 * Retry policy per job. Email delivery backs off for about an hour in total:
 * long enough to outlast a provider incident, short enough that a merchant
 * hears about a customer the same hour. The job marks its row `failed` on the
 * last attempt, so a row never sits `pending` after the queue has given up.
 */
export const QUEUE_POLICY: Record<JobName, { retryLimit: number; retryDelay: number }> = {
  [JOBS.escalationEmail]: { retryLimit: 6, retryDelay: 30 },
  [JOBS.escalationDigest]: { retryLimit: 6, retryDelay: 30 },
  [JOBS.productChanged]: { retryLimit: 4, retryDelay: 60 },
};

export interface QueueConnection {
  queue: JobQueue;
  boss: PgBoss;
  stop(): Promise<void>;
}

export const connectQueue = async (
  connectionString: string,
  options: { role: 'producer' | 'worker' },
): Promise<QueueConnection> => {
  const boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    createSchema: false,
    // Only the worker maintains the queue. Two processes both running
    // maintenance is harmless but pointless; a producer that cannot reach the
    // schema should fail on send, not on a background timer.
    supervise: options.role === 'worker',
    schedule: false,
  });
  await boss.start();
  for (const name of Object.values(JOBS)) {
    const policy = QUEUE_POLICY[name];
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, { ...policy, retryBackoff: true });
    }
  }

  const queue: JobQueue = {
    enqueue: async <N extends JobName>(
      name: N,
      data: JobPayloads[N],
      enqueueOptions: EnqueueOptions = {},
    ) => {
      await boss.send(name, data, {
        ...(enqueueOptions.transaction !== undefined
          ? { db: fromDrizzle(enqueueOptions.transaction as DrizzleTransactionLike, sql) }
          : {}),
        ...(enqueueOptions.startAfterSeconds !== undefined
          ? { startAfter: enqueueOptions.startAfterSeconds }
          : {}),
        ...(enqueueOptions.singletonKey !== undefined
          ? { singletonKey: enqueueOptions.singletonKey }
          : {}),
        ...(enqueueOptions.singletonSeconds !== undefined
          ? { singletonSeconds: enqueueOptions.singletonSeconds }
          : {}),
      });
    },
  };
  return { queue, boss, stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
};
