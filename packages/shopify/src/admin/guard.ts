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
  // Both halves of the seeding credential. The Dev Dashboard hands out a
  // Client Secret rather than a static token, so the secret is now the value
  // most likely to be pasted into the wrong variable: it looks like a token
  // and is not one.
  const forbidden = [env.SHOPIFY_SEED_TOKEN, env.SHOPIFY_CLIENT_SECRET]
    .map((value) => (value ?? '').trim())
    .filter((value) => value.length > 0);

  if (forbidden.includes(token.trim())) {
    // The credential itself never appears in the message.
    throw new BitcError(
      'seed_credential_in_runtime',
      'A seeding credential was passed to the runtime client. Seeding carries write scopes ' +
        "and the agent is read-only by design. Use the agent app's own access token.",
      { customerSafe: false },
    );
  }
};
