import { describe, expect, it } from 'vitest';
import { createLogger, redact, redactText } from '../src/index.ts';

describe('redaction', () => {
  it('removes email addresses, including non-Latin local parts', () => {
    expect(redactText('write to ahmed@example.com please')).toBe('write to [email] please');
    expect(redactText('أحمد@example.com')).toBe('[email]');
  });

  it('removes phone numbers in Gulf and international formats', () => {
    expect(redactText('call +966 55 123 4567')).toBe('call [phone]');
    expect(redactText('call 0551234567')).toBe('call [phone]');
    expect(redactText('call +20 (100) 555-1234')).toBe('call [phone]');
  });

  it('removes long digit runs that could be order or tracking numbers', () => {
    expect(redactText('order 1886204155')).toBe('order [number]');
  });

  it('leaves ordinary numbers alone', () => {
    expect(redactText('14 days, size 42')).toBe('14 days, size 42');
  });

  it('replaces sensitive fields by name whatever the value looks like', () => {
    const out = redact({
      email: 'a@b.com',
      customerName: 'Ahmed',
      access_token: 'shpat_xyz',
      note: 'ships in 3 days',
    }) as Record<string, unknown>;

    expect(out.email).toBe('[redacted]');
    expect(out.customerName).toBe('[redacted]');
    expect(out.access_token).toBe('[redacted]');
    expect(out.note).toBe('ships in 3 days');
  });

  it('walks nested structures and arrays', () => {
    const out = redact({
      conversation: { messages: [{ content: 'reach me at a@b.com' }] },
    }) as { conversation: { messages: { content: string }[] } };
    expect(out.conversation.messages[0]?.content).toBe('reach me at [email]');
  });

  it('redacts error messages without losing the error type', () => {
    const out = redact(new Error('failed for ahmed@example.com')) as {
      name: string;
      message: string;
    };
    expect(out.name).toBe('Error');
    expect(out.message).toBe('failed for [email]');
  });

  it('cannot be bypassed by the logger', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', write: (line) => lines.push(line) });
    log.info('customer ahmed@example.com asked about order 1886204155', {
      phone: '+966551234567',
      lang: 'ar',
    });

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.msg).toBe('customer [email] asked about order [number]');
    expect(entry.phone).toBe('[redacted]');
    expect(entry.lang).toBe('ar');
  });

  it('carries child bindings through redaction too', () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) }).child({
      tenantId: 't-1',
      email: 'leak@example.com',
    });
    log.warn('hello');
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.tenantId).toBe('t-1');
    expect(entry.email).toBe('[redacted]');
  });

  it('honours the level threshold', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', write: (line) => lines.push(line) });
    log.info('quiet');
    log.error('loud');
    expect(lines).toHaveLength(1);
  });
});
