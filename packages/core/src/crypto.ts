import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Encryption at rest for third-party credentials.
 *
 * The only thing this protects is a Shopify access token, and the threat is
 * narrow and specific: **a database dump should not be a set of working
 * credentials for every merchant's store.** A backup on a laptop, a snapshot
 * in the wrong bucket, a support engineer with read access — none of those
 * should hand over the ability to read a store's orders.
 *
 * It does NOT protect against an attacker who has the application's
 * environment, because the application must be able to decrypt to work. Saying
 * so plainly because "encrypted at rest" is a phrase that gets read as more
 * than it is.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than producing
 * garbage plaintext that something downstream then trusts. A fresh 96-bit IV
 * per encryption, from the CSPRNG — GCM fails catastrophically on IV reuse, and
 * 96 bits random is the documented safe construction.
 */

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export interface KeyRing {
  /** The key new ciphertext is written with. */
  current: { version: number; key: Buffer };
  /**
   * Retired keys, still readable.
   *
   * Rotation is not atomic: old rows carry the old version until something
   * rewrites them. A key ring that could only decrypt the current key would
   * make rotation an outage.
   */
  previous?: { version: number; key: Buffer }[];
}

const IV_BYTES = 12;
const KEY_BYTES = 32;

export const keyFromBase64 = (value: string, label = 'key'): Buffer => {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    // Length only. The value never appears in an error, a log or a stack.
    throw new Error(`${label} must be ${KEY_BYTES} bytes base64, got ${key.length}`);
  }
  return key;
};

export const seal = (plaintext: string, ring: KeyRing): Sealed => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', ring.current.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: ring.current.version,
  };
};

export const open = (sealed: Sealed, ring: KeyRing): string => {
  const candidates = [ring.current, ...(ring.previous ?? [])];
  const entry = candidates.find((k) => k.version === sealed.keyVersion);
  if (!entry) {
    throw new Error(
      `no key for version ${sealed.keyVersion} — the ring has ${candidates
        .map((k) => k.version)
        .join(', ')}`,
    );
  }
  const decipher = createDecipheriv('aes-256-gcm', entry.key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  // Throws on a bad tag, which is the point: a tampered row fails loudly
  // rather than returning plausible-looking rubbish.
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

/**
 * Whether a sealed value was written with a key that is no longer current.
 *
 * Rotation works by re-sealing what this returns true for. Without it, a
 * retired key stays load-bearing for ever and "rotated" means "added a key".
 */
export const needsRotation = (sealed: Sealed, ring: KeyRing): boolean =>
  sealed.keyVersion !== ring.current.version;

/** Constant-time equality, for comparing a secret against an expected value. */
export const secretsMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * Builds a ring from the environment.
 *
 * ENCRYPTION_KEY_PREVIOUS is a retired key kept readable during a rotation. Its
 * version is the current one minus one, which is the whole versioning scheme —
 * enough for one rotation in flight, and it is deliberately not more than that,
 * because a scheme that supports six simultaneous keys invites six.
 */
export const ringFromEnv = (env: {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_VERSION: number;
  ENCRYPTION_KEY_PREVIOUS?: string | undefined;
}): KeyRing => ({
  current: {
    version: env.ENCRYPTION_KEY_VERSION,
    key: keyFromBase64(env.ENCRYPTION_KEY, 'ENCRYPTION_KEY'),
  },
  ...(env.ENCRYPTION_KEY_PREVIOUS
    ? {
        previous: [
          {
            version: env.ENCRYPTION_KEY_VERSION - 1,
            key: keyFromBase64(env.ENCRYPTION_KEY_PREVIOUS, 'ENCRYPTION_KEY_PREVIOUS'),
          },
        ],
      }
    : {}),
});
