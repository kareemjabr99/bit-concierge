import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertNotSeedToken } from '../packages/shopify/src/admin/guard.ts';

/**
 * Seeding needs write scopes. The agent must never have them.
 *
 * Two apps, two tokens, on purpose — and the separation is worth exactly as
 * much as the thing enforcing it. Two rules do that: nothing on the runtime
 * path may name the seed variable, and nothing may accept its value.
 */

/** Everything that runs in production. Scripts are tooling, not runtime. */
const RUNTIME = [...globSync('packages/*/src/**/*.ts'), ...globSync('apps/*/src/**/*.ts')].filter(
  (p) => !p.includes('/scripts/'),
);

describe('the seed token cannot reach the runtime', () => {
  it('is looking at the files it thinks it is', () => {
    expect(RUNTIME.length).toBeGreaterThan(20);
    expect(RUNTIME).toContain('packages/agent/src/loop.ts');
  });

  it.each(RUNTIME)('%s does not read SHOPIFY_SEED_TOKEN', (path) => {
    const content = readFileSync(path, 'utf8');
    // The guard names it in order to compare against it, which is the one
    // legitimate use; everything else reading it would be the bug.
    if (path.endsWith('admin/guard.ts')) return;
    for (const name of ['SHOPIFY_SEED_TOKEN', 'SHOPIFY_CLIENT_SECRET']) {
      expect(
        content.includes(name),
        `${path} reads ${name}. Seeding carries write scopes and the agent is read-only ` +
          `by design — it must use the agent app's own token.`,
      ).toBe(false);
    }
  });

  it('refuses the Dev Dashboard client secret too', () => {
    // The Dev Dashboard hands out a Client Secret rather than a static token,
    // so the secret is now the value most likely to be pasted into the wrong
    // variable: it looks like a token and is not one.
    const env = { SHOPIFY_CLIENT_SECRET: 'FAKE CREDENTIAL — client secret' };
    expect(() => assertNotSeedToken('FAKE CREDENTIAL — client secret', env)).toThrow(
      /seeding credential was passed to the runtime/,
    );
  });

  it('refuses the seed token by VALUE, whatever variable carries it', () => {
    // Checking the name alone would miss the same secret arriving as
    // SHOPIFY_ACCESS_TOKEN, which is exactly how this mistake gets made: a
    // token pasted into the wrong variable during a deploy.
    const env = { SHOPIFY_SEED_TOKEN: 'FAKE CREDENTIAL — seed token' };
    expect(() => assertNotSeedToken('FAKE CREDENTIAL — seed token', env)).toThrow(
      /seeding credential was passed to the runtime/,
    );
    expect(() => assertNotSeedToken('FAKE CREDENTIAL — agent token', env)).not.toThrow();
  });

  it('ignores surrounding whitespace, because .env files collect it', () => {
    const env = { SHOPIFY_SEED_TOKEN: '  FAKE CREDENTIAL — seed token \n' };
    expect(() => assertNotSeedToken('FAKE CREDENTIAL — seed token', env)).toThrow();
  });

  it('does nothing when no seed token is configured', () => {
    // Production has no SHOPIFY_SEED_TOKEN at all, and an empty value must not
    // match an empty-ish token and break every request.
    expect(() => assertNotSeedToken('', {})).not.toThrow();
    expect(() => assertNotSeedToken('anything', { SHOPIFY_SEED_TOKEN: '' })).not.toThrow();
    expect(() => assertNotSeedToken('anything', { SHOPIFY_CLIENT_SECRET: '' })).not.toThrow();
  });

  it('never puts the token in the error', () => {
    const env = { SHOPIFY_SEED_TOKEN: 'FAKE CREDENTIAL — seed token' };
    try {
      assertNotSeedToken('FAKE CREDENTIAL — seed token', env);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('FAKE CREDENTIAL');
    }
  });
});
