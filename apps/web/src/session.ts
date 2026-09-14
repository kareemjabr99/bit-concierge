import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Conversation identity for an anonymous storefront visitor.
 *
 * The widget key in the page source identifies the tenant and authorises
 * nothing — it is public by construction, printed in every visitor's HTML. So
 * the conversation id cannot be a number the client picks: a visitor who could
 * name someone else's conversation would be handed its history on the next
 * turn, and on this product a transcript contains order numbers and email
 * addresses.
 *
 * **The token is signed, and that is the part that matters.** An unsigned
 * random token looks safe and is not: the client sends it back, so the client
 * can send back anything. A visitor posting `token: "AAAAAAAAAAAAAAAAAAAAAA"`
 * gets the conversation belonging to that string, and so does everyone else
 * who sends it. Checking the token's *shape* does not help — a chosen token
 * can be perfectly well-shaped. Only a signature the server can verify
 * distinguishes "a token I issued" from "22 characters someone typed".
 *
 * This was found by mutation-testing the endpoint: removing the shape check
 * changed no test, which was correct, because the shape check was never what
 * made this safe.
 *
 * Stored as the SHA-256 of the token rather than the token, so a database dump
 * does not hand over live sessions — the same reasoning as encrypting Shopify
 * tokens at rest.
 */

const NONCE_BYTES = 16;
/** Truncated to 16 bytes: a forgery oracle here buys a stranger's chat history. */
const TAG_BYTES = 16;
const NONCE_CHARS = 22;
const TAG_CHARS = 22;
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${NONCE_CHARS}}\\.[A-Za-z0-9_-]{${TAG_CHARS}}$`);

/**
 * A signing key derived from the application encryption key.
 *
 * Derived rather than reused directly, so a session token and an encrypted
 * Shopify credential never share key material. Derived rather than added as
 * its own secret, so there is one fewer value to rotate, lose, or leak into a
 * deployment log.
 */
export const deriveSigningKey = (encryptionKeyBase64: string): Buffer =>
  Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKeyBase64, 'base64'), '', 'bitc:web:session:v1', 32),
  );

const sign = (nonce: string, key: Buffer): string =>
  createHmac('sha256', key).update(nonce).digest().subarray(0, TAG_BYTES).toString('base64url');

export const issueToken = (key: Buffer): string => {
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  return `${nonce}.${sign(nonce, key)}`;
};

/**
 * True only for a token this server issued.
 *
 * Shape first, because a malformed string should not reach the comparison at
 * all; then the tag, in constant time.
 */
export const isOurToken = (token: string, key: Buffer): boolean => {
  if (!TOKEN_PATTERN.test(token)) return false;
  const [nonce, tag] = token.split('.') as [string, string];
  const expected = Buffer.from(sign(nonce, key), 'base64url');
  const given = Buffer.from(tag, 'base64url');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
};

/** The external conversation id stored against the token. Never the token. */
export const externalIdFor = (token: string): string =>
  `web:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
