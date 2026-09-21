import { BitcError } from '@bitc/core';

/**
 * The Admin client takes an access token and nothing else.
 *
 * Two different mistakes end up here, and they are not the same mistake:
 *
 * 1. **A seeding credential.** Seeding needs write scopes; the agent must
 *    never have them. Those are two different apps on purpose, and the
 *    separation is worth exactly as much as the thing that enforces it —
 *    which, without this, would be someone remembering. A write scope looks
 *    exactly like a read scope until something writes, so nothing downstream
 *    would notice a read-only assistant quietly holding the ability to cancel
 *    orders.
 *
 * 2. **The agent's own client secret.** The Dev Dashboard hands out a Client
 *    ID and a `shpss_` Client Secret rather than a static token; the secret is
 *    exchanged for a 24-hour access token. It looks like a token and is not
 *    one, so it is the value most likely to be pasted into the wrong variable.
 *    This one is not a privilege escalation — it is a request that fails
 *    confusingly, at runtime, with an authentication error that says nothing
 *    about the cause.
 *
 * Both are refused, and they are refused with different messages. A single
 * message covering both would send someone hunting the wrong bug, which is a
 * cost this project has already paid once.
 *
 * Checked by value rather than by variable name. A guard that only looked for
 * `SHOPIFY_SEED_TOKEN` would miss the same secret arriving as
 * `SHOPIFY_ACCESS_TOKEN`, which is precisely how this mistake gets made.
 */
export const assertAgentAccessToken = (
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const candidate = token.trim();

  // The empty-value case is inside `matches` rather than an early return: an
  // unset variable must not match an empty token and fail every request, and a
  // separate guard for that reads as though it were doing work it is not.
  const matches = (value: string | undefined): boolean =>
    (value ?? '').trim().length > 0 && (value ?? '').trim() === candidate;

  // The credential itself never appears in either message.
  if (matches(env.SHOPIFY_SEED_TOKEN) || matches(env.SHOPIFY_CLIENT_SECRET)) {
    throw new BitcError(
      'seed_credential_in_runtime',
      'A seeding credential was passed to the runtime client. Seeding carries write scopes ' +
        "and the agent is read-only by design. Use the agent app's own access token.",
      { customerSafe: false },
    );
  }

  if (matches(env.SHOPIFY_RUNTIME_CLIENT_SECRET)) {
    throw new BitcError(
      'client_secret_as_access_token',
      "The agent app's client secret was passed to the Admin client. The secret is exchanged " +
        'for a 24-hour access token by the client credentials grant; it is not a token itself ' +
        'and Shopify will reject it.',
      { customerSafe: false },
    );
  }
};
