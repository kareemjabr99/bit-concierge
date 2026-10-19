import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOBS } from '@bitc/core';
import { connectQueue, type QueueConnection } from '../src/queue.ts';
import { admin, APP_URL, prepareDatabase } from './helpers.ts';

/**
 * The queue against a real Postgres, as the application role. Two things the
 * code relies on and a fake would only assume: pg-boss can install itself in
 * the schema migration 0008 made, as a role that cannot change `public`; and
 * a key plus a window throttles, which is what keeps one digest per tenant
 * per hour and one job per webhook delivery. (On a standard queue a key
 * without a window does not deduplicate at all.)
 */

let queue: QueueConnection;

beforeAll(async () => {
  await prepareDatabase();
  queue = await connectQueue(APP_URL, { role: 'producer' });
});

afterAll(async () => {
  await queue.stop();
});

const count = async (key: string): Promise<number> => {
  const sql = admin();
  try {
    const [row] = await sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pgboss.job WHERE singleton_key = $1`,
      [key],
    );
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
};

describe('the job queue', () => {
  it('installs in its own schema as the application role, and owns nothing in public', async () => {
    const sql = admin();
    try {
      const owned = await sql.unsafe<{ schemaname: string }[]>(
        `SELECT DISTINCT schemaname FROM pg_tables WHERE tablename IN ('job', 'queue', 'version')
           AND schemaname <> 'information_schema'`,
      );
      expect(owned.map((r) => r.schemaname)).toEqual(['pgboss']);
    } finally {
      await sql.end();
    }
  });

  it('throttles a key inside its window to one job', async () => {
    const key = `test-${Date.now()}`;
    const data = { tenantId: '00000000-0000-4000-8000-000000000001' };
    for (let i = 0; i < 3; i += 1) {
      await queue.queue.enqueue(JOBS.escalationDigest, data, {
        singletonKey: key,
        singletonSeconds: 3600,
        startAfterSeconds: 3600,
      });
    }
    expect(await count(key)).toBe(1);
  });

  it('keeps different keys apart', async () => {
    const stamp = Date.now();
    const data = { tenantId: '00000000-0000-4000-8000-000000000001' };
    await queue.queue.enqueue(JOBS.escalationDigest, data, {
      singletonKey: `a-${stamp}`,
      singletonSeconds: 3600,
    });
    await queue.queue.enqueue(JOBS.escalationDigest, data, {
      singletonKey: `b-${stamp}`,
      singletonSeconds: 3600,
    });
    expect((await count(`a-${stamp}`)) + (await count(`b-${stamp}`))).toBe(2);
  });
});
