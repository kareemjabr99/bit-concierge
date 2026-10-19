import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, type TenantId } from '@bitc/core';
import { disconnect } from '@bitc/db';
import {
  admin,
  dropTenant,
  prepareDatabase,
  seedTestTenant,
  uniqueId,
} from '../../../packages/agent/test/helpers.ts';
import { EmailRejected, type EmailSender, type OutgoingEmail } from '../src/email/sender.ts';
import { deliverDigest, deliverEscalation } from '../src/jobs/escalation-email.ts';

/**
 * Delivery against the real schema and row-level security, with a fake
 * provider. The properties: a row is sent at most once however often its job
 * runs; it ends `sent` or `failed`, or stays `pending` only while the queue
 * will try again; and a job can only reach its own tenant's rows.
 */

const STATUS_LINK =
  'https://bitc-dev.myshopify.com/123/orders/abcdef0123456789/authenticate?key=0123abcd';

const logger = createLogger({ level: 'error', write: () => {} });

const fakeSender = (behaviour: 'ok' | 'busy' | 'refuse' = 'ok') => {
  const sent: OutgoingEmail[] = [];
  const sender: EmailSender = {
    send: async (message) => {
      if (behaviour === 'busy') throw new Error('Resend 503 service_unavailable');
      if (behaviour === 'refuse') throw new EmailRejected('Resend 403 validation_error');
      // A real provider call takes time; this is what lets two concurrent
      // deliveries overlap in the duplicate test below.
      await new Promise((r) => setTimeout(r, 50));
      sent.push(message);
      return { id: `em_${sent.length}` };
    },
  };
  return { sender, sent };
};

let tenantId: TenantId;
let other: TenantId;

beforeAll(async () => {
  await prepareDatabase();
  tenantId = await seedTestTenant(uniqueId('mail'));
  other = await seedTestTenant(uniqueId('mail-other'));
});

afterAll(async () => {
  await dropTenant(tenantId);
  await dropTenant(other);
  await disconnect();
});

beforeEach(async () => {
  const sql = admin();
  try {
    await sql.unsafe(`DELETE FROM escalations WHERE tenant_id = $1`, [tenantId]);
    await sql.unsafe(`DELETE FROM escalation_digests WHERE tenant_id = $1`, [tenantId]);
  } finally {
    await sql.end();
  }
});

/** Writes a conversation and an escalation row as the admin role. */
const escalation = async (
  tenant: TenantId,
  over: { status?: string; sentTo?: string[]; summary?: string; reason?: string } = {},
): Promise<string> => {
  const sql = admin();
  try {
    const [c] = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO conversations (tenant_id, channel, external_id) VALUES ($1, 'web', $2) RETURNING id`,
      [tenant, uniqueId('conv')],
    );
    const [e] = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO escalations (tenant_id, conversation_id, reason, summary, contact, sent_to, delivery_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [
        tenant,
        c!.id,
        over.reason ?? 'complaint',
        over.summary ?? `Parcel late; customer pasted ${STATUS_LINK}`,
        JSON.stringify({ name: 'Sara', email: 'sara@example.com' }),
        over.sentTo ?? ['ops@bitc.example'],
        over.status ?? 'pending',
      ],
    );
    return e!.id;
  } finally {
    await sql.end();
  }
};

const statusOf = async (id: string): Promise<{ status: string; sentAt: Date | null }> => {
  const sql = admin();
  try {
    const [row] = await sql.unsafe<{ delivery_status: string; sent_at: Date | null }[]>(
      `SELECT delivery_status, sent_at FROM escalations WHERE id = $1`,
      [id],
    );
    return { status: row!.delivery_status, sentAt: row!.sent_at };
  } finally {
    await sql.end();
  }
};

describe('one escalation email', () => {
  it('sends the row to the addresses it names and marks it sent', async () => {
    const id = await escalation(tenantId);
    const { sender, sent } = fakeSender();
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).toBe('sent');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['ops@bitc.example']);
    expect(sent[0]!.idempotencyKey).toBe(`escalation-${id}`);
    expect(sent[0]!.subject).toBe('[1886] A customer needs a person: complaint');
    expect(sent[0]!.text).toContain('Parcel late');
    expect(sent[0]!.text).toContain('Email: sara@example.com');
    const after = await statusOf(id);
    expect(after.status).toBe('sent');
    expect(after.sentAt).not.toBeNull();
  });

  it('strips an order status link from what it forwards (ADR 0012)', async () => {
    const id = await escalation(tenantId);
    const { sender, sent } = fakeSender();
    await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false });
    expect(sent[0]!.text).not.toContain('authenticate?key=');
    expect(sent[0]!.text).toContain('[status-link]');
  });

  it('sends once when the same job is delivered twice at the same moment', async () => {
    const id = await escalation(tenantId);
    const { sender, sent } = fakeSender();
    const job = { tenantId, escalationId: id };
    const outcomes = await Promise.all([
      deliverEscalation({ sender, logger }, job, { final: false }),
      deliverEscalation({ sender, logger }, job, { final: false }),
    ]);
    expect(outcomes.sort()).toEqual(['sent', 'skipped']);
    expect(sent).toHaveLength(1);
  });

  it('leaves a row that was already sent alone', async () => {
    const id = await escalation(tenantId, { status: 'sent' });
    const { sender, sent } = fakeSender();
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('rethrows a busy provider and leaves the row pending for the retry', async () => {
    const id = await escalation(tenantId);
    const { sender } = fakeSender('busy');
    await expect(
      deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).rejects.toThrow(/503/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('marks the row failed on the last attempt instead of leaving it pending', async () => {
    const id = await escalation(tenantId);
    const { sender } = fakeSender('busy');
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: true }),
    ).toBe('failed');
    expect((await statusOf(id)).status).toBe('failed');
  });

  it('marks a refused message failed at once — retrying a refusal only delays it', async () => {
    const id = await escalation(tenantId);
    const { sender } = fakeSender('refuse');
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).toBe('failed');
    expect((await statusOf(id)).status).toBe('failed');
  });

  it('marks a row with nobody to send to failed, without calling the provider', async () => {
    const id = await escalation(tenantId, { sentTo: [] });
    const { sender, sent } = fakeSender();
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).toBe('failed');
    expect(sent).toHaveLength(0);
  });

  it("cannot reach another tenant's row, whatever the job says", async () => {
    const id = await escalation(other);
    const { sender, sent } = fakeSender();
    expect(
      await deliverEscalation({ sender, logger }, { tenantId, escalationId: id }, { final: false }),
    ).toBe('missing');
    expect(sent).toHaveLength(0);
    expect((await statusOf(id)).status).toBe('pending');
  });
});

describe('the hourly digest', () => {
  it('sends every digested escalation in one message and links them to the digest', async () => {
    const ids = [
      await escalation(tenantId, { status: 'digested', reason: 'complaint' }),
      await escalation(tenantId, { status: 'digested', reason: 'refund_or_money' }),
      await escalation(tenantId, { status: 'digested', sentTo: ['lead@bitc.example'] }),
    ];
    const pendingId = await escalation(tenantId);
    const { sender, sent } = fakeSender();
    expect(await deliverDigest({ sender, logger }, { tenantId }, { final: false })).toBe('sent');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('[1886] 3 customers need a person (hourly digest)');
    expect(sent[0]!.to.sort()).toEqual(['lead@bitc.example', 'ops@bitc.example']);
    expect(sent[0]!.text).toContain('refund_or_money');
    expect(sent[0]!.text).not.toContain('authenticate?key=');

    const sql = admin();
    try {
      const rows = await sql.unsafe<{ id: string; digest_id: string | null }[]>(
        `SELECT id, digest_id FROM escalations WHERE tenant_id = $1`,
        [tenantId],
      );
      const linked = rows.filter((r) => r.digest_id !== null).map((r) => r.id);
      expect(linked.sort()).toEqual([...ids].sort());
      expect(rows.find((r) => r.id === pendingId)?.digest_id).toBeNull();
      const [digest] = await sql.unsafe<{ escalation_count: number; sent_at: Date | null }[]>(
        `SELECT escalation_count, sent_at FROM escalation_digests WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(digest?.escalation_count).toBe(3);
      expect(digest?.sent_at).not.toBeNull();
    } finally {
      await sql.end();
    }

    // The next hour's job finds nothing left to send.
    expect(await deliverDigest({ sender, logger }, { tenantId }, { final: false })).toBe('empty');
    expect(sent).toHaveLength(1);
  });

  it('keys a retry by the escalations it covers, so a retry cannot send twice', async () => {
    await escalation(tenantId, { status: 'digested' });
    const busy = fakeSender('busy');
    await expect(
      deliverDigest({ sender: busy.sender, logger }, { tenantId }, { final: false }),
    ).rejects.toThrow();
    const keys: string[] = [];
    const recording: EmailSender = {
      send: async (m) => {
        keys.push(m.idempotencyKey);
        throw new Error('Resend 503');
      },
    };
    await expect(
      deliverDigest({ sender: recording, logger }, { tenantId }, { final: false }),
    ).rejects.toThrow();
    await expect(
      deliverDigest({ sender: recording, logger }, { tenantId }, { final: false }),
    ).rejects.toThrow();
    expect(new Set(keys).size).toBe(1);
  });

  it('marks the escalations failed on the last attempt and keeps no unsent digest', async () => {
    const id = await escalation(tenantId, { status: 'digested' });
    const { sender } = fakeSender('busy');
    expect(await deliverDigest({ sender, logger }, { tenantId }, { final: true })).toBe('failed');
    expect((await statusOf(id)).status).toBe('failed');
    const sql = admin();
    try {
      const digests = await sql.unsafe(`SELECT 1 FROM escalation_digests WHERE tenant_id = $1`, [
        tenantId,
      ]);
      expect(digests).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});
