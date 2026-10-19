import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnect, withTenant } from '@bitc/db';
import { connectQueue, type QueueConnection } from '@bitc/db/queue';
import { createLogger, JOBS, type EnqueueOptions, type JobQueue, type TenantId } from '@bitc/core';
import { runTurn } from '../src/index.ts';
import {
  admin,
  APP_URL,
  depsWith,
  dropTenant,
  prepareDatabase,
  scripted,
  seedTestTenant,
  uniqueId,
} from './helpers.ts';

/**
 * escalate() tells the worker by enqueueing a job in the same transaction as
 * the row. Three properties: the job carries ids and nothing else; a turn
 * without a queue (the CLI, the eval runner) sends nothing; and a queue that
 * fails costs the email, never the escalation.
 */

interface Enqueued {
  name: string;
  data: unknown;
  options: EnqueueOptions;
}

const recordingQueue = (fail = false): { jobs: JobQueue; seen: Enqueued[] } => {
  const seen: Enqueued[] = [];
  return {
    seen,
    jobs: {
      enqueue: async (name, data, options = {}) => {
        if (fail) throw new Error('queue schema missing');
        seen.push({ name, data, options });
      },
    },
  };
};

const complaint = {
  tools: [
    {
      name: 'escalate_to_human',
      input: {
        reason: 'complaint',
        summary: 'Customer is upset about a late parcel. Contact: sara@example.com',
      },
    },
  ],
};

let tenantId: TenantId;
let capped: TenantId;

beforeAll(async () => {
  await prepareDatabase();
  tenantId = await seedTestTenant(uniqueId('enqueue'));
  capped = await seedTestTenant(uniqueId('enqueue-capped'), { maxEscalationsPerHour: 0 });
});

afterAll(async () => {
  await dropTenant(tenantId);
  await dropTenant(capped);
  await disconnect();
});

const turn = (tenant: TenantId, jobs?: JobQueue) =>
  runTurn(
    {
      tenantId: tenant,
      channel: 'web',
      externalConversationId: uniqueId('c'),
      text: 'This is the third time I am writing, my parcel is late and I am angry',
    },
    { ...depsWith(scripted([complaint, { text: 'ok' }])), ...(jobs ? { jobs } : {}) },
  );

describe('escalate() and the queue', () => {
  it('enqueues the email job, with ids only, inside the transaction', async () => {
    const { jobs, seen } = recordingQueue();
    const r = await turn(tenantId, jobs);
    const escalation = r.recorder.escalation!;
    expect(escalation.deliveryStatus).toBe('pending');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe(JOBS.escalationEmail);
    expect(seen[0]!.data).toEqual({ tenantId, escalationId: escalation.id });
    // The customer's words stay in the row, under row-level security.
    expect(JSON.stringify(seen[0]!.data)).not.toContain('sara@example.com');
    expect(seen[0]!.options.transaction).toBeDefined();
  });

  it('above the hourly cap, enqueues one digest per tenant per hour instead', async () => {
    const { jobs, seen } = recordingQueue();
    const r = await turn(capped, jobs);
    expect(r.recorder.escalation!.deliveryStatus).toBe('digested');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe(JOBS.escalationDigest);
    expect(seen[0]!.data).toEqual({ tenantId: capped });
    expect(seen[0]!.options).toMatchObject({
      singletonKey: capped,
      singletonSeconds: 3600,
      startAfterSeconds: 3600,
    });
  });

  it('writes the escalation even when the queue fails, and says so in the log', async () => {
    const { jobs } = recordingQueue(true);
    const lines: string[] = [];
    const r = await runTurn(
      {
        tenantId,
        channel: 'web',
        externalConversationId: uniqueId('c'),
        text: 'I want to complain about my order',
      },
      {
        ...depsWith(scripted([complaint, { text: 'ok' }])),
        jobs,
        logger: createLogger({ level: 'error', write: (line) => void lines.push(line) }),
      },
    );
    const id = r.recorder.escalation!.id;
    const sql = admin();
    try {
      const [row] = await sql.unsafe<{ delivery_status: string }[]>(
        `SELECT delivery_status FROM escalations WHERE id = $1`,
        [id],
      );
      expect(row?.delivery_status).toBe('pending');
    } finally {
      await sql.end();
    }
    expect(lines.join('\n')).toContain('escalation_enqueue_failed');
  });

  it('sends nothing without a queue — the CLI and the eval runner pass none', async () => {
    const r = await turn(tenantId);
    expect(r.recorder.escalation!.deliveryStatus).toBe('pending');
  });
});

describe('against the real queue', () => {
  let queue: QueueConnection;
  beforeAll(async () => {
    queue = await connectQueue(APP_URL, { role: 'producer' });
  });
  afterAll(async () => {
    await queue.stop();
  });

  const jobsFor = async (escalationId: string): Promise<number> => {
    const sql = admin();
    try {
      const [row] = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'escalationId' = $2`,
        [JOBS.escalationEmail, escalationId],
      );
      return row?.n ?? 0;
    } finally {
      await sql.end();
    }
  };

  it('commits the job with the row', async () => {
    const r = await turn(tenantId, queue.queue);
    expect(await jobsFor(r.recorder.escalation!.id)).toBe(1);
  });

  it('rolls the job back with a transaction that does not commit', async () => {
    const escalationId = crypto.randomUUID();
    await expect(
      withTenant(tenantId, async (tx) => {
        await queue.queue.enqueue(
          JOBS.escalationEmail,
          { tenantId, escalationId },
          { transaction: tx },
        );
        throw new Error('the escalation insert failed after the enqueue');
      }),
    ).rejects.toThrow(/insert failed/);
    expect(await jobsFor(escalationId)).toBe(0);
  });
});
