import { describe, expect, it } from 'vitest';
import { ConfigError, readEnv } from '../src/index.ts';

describe('environment', () => {
  it('applies defaults for optional base settings', () => {
    const env = readEnv('base', { DATABASE_URL: 'postgres://localhost/x' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('reports every missing key at once, not just the first', () => {
    try {
      readEnv('encryption', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('ENCRYPTION_KEY');
    }
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      readEnv('encryption', { ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(ConfigError);

    expect(() =>
      readEnv('encryption', { ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') }),
    ).not.toThrow();
  });

  it('splits the widget origin allowlist', () => {
    const env = readEnv('web', {
      WIDGET_ALLOWED_ORIGINS: 'https://1886riyadh.com, https://shop.1886riyadh.com',
    });
    expect(env.WIDGET_ALLOWED_ORIGINS).toEqual([
      'https://1886riyadh.com',
      'https://shop.1886riyadh.com',
    ]);
  });

  it('defaults the origin allowlist to empty rather than permissive', () => {
    expect(readEnv('web', {}).WIDGET_ALLOWED_ORIGINS).toEqual([]);
  });
});
