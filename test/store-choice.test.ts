import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Which store a conversation talks to is decided in one place.
 *
 * `createShopifyClient` (packages/shopify/src/factory.ts) is the only thing
 * allowed to choose the mock, and it does so only when no Shopify variable is
 * set. An entry point that constructs `MockShopifyClient` itself answers
 * customers from synthetic orders while looking exactly like one answering
 * from the store. `apps/web` did that until 2026-10-18, after the CLI and the
 * eval runner had moved to the factory.
 */

const RUNTIME = [...globSync('packages/*/src/**/*.ts'), ...globSync('apps/*/src/**/*.ts')];

describe('only the factory chooses the mock', () => {
  it('is looking at the files it thinks it is', () => {
    expect(RUNTIME).toContain('apps/web/src/server.ts');
    expect(RUNTIME).toContain('apps/cli/src/chat.ts');
    expect(RUNTIME).toContain('packages/evals/src/cli.ts');
  });

  it.each(RUNTIME)('%s does not construct MockShopifyClient', (path) => {
    if (path === 'packages/shopify/src/factory.ts') return;
    expect(
      /new\s+MockShopifyClient\b/.test(readFileSync(path, 'utf8')),
      `${path} builds the mock store itself. Use createShopifyClient from @bitc/shopify.`,
    ).toBe(false);
  });
});
