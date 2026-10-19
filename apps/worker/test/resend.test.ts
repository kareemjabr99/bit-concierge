import { describe, expect, it, vi } from 'vitest';
import { createResendSender } from '../src/email/resend.ts';
import { EmailRejected } from '../src/email/sender.ts';

/**
 * The sender decides one thing that matters: whether a failure is worth
 * retrying. Retrying a refusal delays the row being marked `failed` by an
 * hour; not retrying a busy provider loses an email that would have gone.
 */

const KEY = 'FAKE CREDENTIAL — resend key';

const reply = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const sender = (response: Response) => {
  const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => response);
  return {
    send: createResendSender({
      apiKey: KEY,
      from: 'Bit Concierge <alerts@bitc.example>',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send,
    fetchImpl,
  };
};

const message = {
  to: ['ops@bitc.example'],
  subject: 'A customer needs a person',
  text: 'body',
  idempotencyKey: 'escalation-1',
};

describe('the Resend sender', () => {
  it('posts the message with the key as a bearer token and the idempotency key', async () => {
    const { send, fetchImpl } = sender(reply(200, { id: 'em_1' }));
    expect(await send(message)).toEqual({ id: 'em_1' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['idempotency-key']).toBe('escalation-1');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Bit Concierge <alerts@bitc.example>',
      to: ['ops@bitc.example'],
      subject: 'A customer needs a person',
      text: 'body',
    });
  });

  it('treats a 2xx with no id as unconfirmed, not sent', async () => {
    const { send } = sender(reply(200, {}));
    const error = await send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EmailRejected);
  });

  it.each([
    [429, 'rate_limit_exceeded'],
    [429, 'daily_quota_exceeded'],
    [500, 'application_error'],
    [503, 'service_unavailable'],
    [409, 'concurrent_idempotent_requests'],
    [409, 'resource_locked'],
  ])('retries %i %s', async (status, name) => {
    const { send } = sender(reply(status, { name, message: 'later' }));
    const error = await send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EmailRejected);
  });

  it.each([
    [400, 'validation_error'],
    [401, 'missing_api_key'],
    [403, 'validation_error'],
    [404, 'not_found'],
    [409, 'invalid_idempotent_request'],
    [422, 'missing_required_field'],
  ])('does not retry %i %s', async (status, name) => {
    const { send } = sender(reply(status, { name, message: 'no' }));
    await expect(send(message)).rejects.toBeInstanceOf(EmailRejected);
  });

  it('never puts the key in an error', async () => {
    for (const status of [401, 503]) {
      const { send } = sender(reply(status, { name: 'x', message: 'y' }));
      const error = (await send(message).catch((e: unknown) => e)) as Error;
      expect(error.message).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(KEY);
    }
  });
});
