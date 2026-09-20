import { BitcError } from '@bitc/core';

/**
 * The seed token must never reach the runtime.
 *
 * Seeding needs write scopes; the agent must never have them. Those are two
 * different apps on purpose, and the separation is worth exactly as much as
 * the thing that enforces it — which, without this, would be someone
 * remembering.
 *
 * The failure it guards against is mundane rather than malicious: a token
 * pasted into the wrong environment variable during a deploy. That is a
 * read-only assistant silently holding the ability to cancel orders, and
 * nothing downstream would notice, because a write scope looks exactly like a
 * read scope until something writes.
 *
 * Checked by value rather than by variable name. A guard that only looked for
 * `SHOPIFY_SEED_TOKEN` would miss the same secret arriving as
 * `SHOPIFY_ACCESS_TOKEN`, which is precisely how this mistake gets made.
 */
export const assertNotSeedToken = (token: string, env: NodeJS.ProcessEnv = process.env): void => {
  const seed = (env.SHOPIFY_SEED_TOKEN ?? '').trim();
  if (seed.length > 0 && token.trim() === seed) {
    // The token itself never appears in the message.
    throw new BitcError(
      'seed_token_in_runtime',
      'The Shopify SEED token was passed to the runtime client. That token carries write ' +
        "scopes and the agent is read-only by design. Use the agent app's own access token.",
      { customerSafe: false },
    );
  }
};
