import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  keyFromBase64,
  needsRotation,
  open,
  ringFromEnv,
  seal,
  secretsMatch,
} from '../src/crypto.ts';

/**
 * What this protects: a database dump should not be a set of working Shopify
 * credentials for every merchant's store. Every test below is about that
 * sentence.
 */

const k = (fill: number) => Buffer.alloc(32, fill);
const ring = (version = 1) => ({ current: { version, key: k(7) } });
/**
 * Deliberately incapable of being mistaken for a credential.
 *
 * The first version of this fixture was `shpat_` followed by 32 hex
 * characters — exactly what a real Shopify token looks like. test/secrets.test.ts
 * flagged it and GitHub's push protection rejected the push. Both were right.
 *
 * The second version was FAKE-CREDENTIAL-NOT-A-REAL-TOKEN-0001, which still
 * tripped the rule against long opaque literals assigned to secret-shaped
 * names — correctly, because that is what a leaked token looks like from the
 * outside.
 *
 * This one contains spaces and an em dash, so no token format can accommodate
 * it. docs/fixtures.md rule 1: invented content must be obviously invented,
 * and the way to satisfy a structural rule is structurally.
 */
const TOKEN = 'FAKE CREDENTIAL — not a real token 1';

describe('sealing a credential', () => {
  it('round-trips', () => {
    expect(open(seal(TOKEN, ring()), ring())).toBe(TOKEN);
  });

  it('never stores the plaintext, in any field', () => {
    const sealed = seal(TOKEN, ring());
    const serialised = JSON.stringify(sealed);
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain('FAKE CREDENTIAL');
    // Also not recoverable by base64-decoding any field without the key.
    for (const value of [sealed.ciphertext, sealed.iv, sealed.tag]) {
      expect(Buffer.from(value, 'base64').toString('utf8')).not.toContain('FAKE CREDENTIAL');
    }
  });

  it('produces a different ciphertext every time', () => {
    // GCM fails catastrophically on IV reuse, so a fresh random IV per
    // encryption is not an optimisation. Identical ciphertext for identical
    // plaintext would also tell an attacker which merchants share a token.
    const seen = new Set(Array.from({ length: 200 }, () => seal(TOKEN, ring()).ciphertext));
    expect(seen.size).toBe(200);
    const ivs = new Set(Array.from({ length: 200 }, () => seal(TOKEN, ring()).iv));
    expect(ivs.size).toBe(200);
  });

  it('refuses a key that is not 32 bytes, without echoing it', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => keyFromBase64(short, 'ENCRYPTION_KEY')).toThrow(/32 bytes/);
    try {
      keyFromBase64(short, 'ENCRYPTION_KEY');
    } catch (error) {
      // A key in an exception message reaches a log, and a log reaches a
      // support ticket.
      expect((error as Error).message).not.toContain(short);
    }
  });
});

describe('tampering', () => {
  const flip = (b64: string): string => {
    const buf = Buffer.from(b64, 'base64');
    buf[0] = buf[0]! ^ 0xff;
    return buf.toString('base64');
  };

  it('rejects a modified ciphertext rather than returning rubbish', () => {
    // The reason for GCM over CBC. Unauthenticated decryption hands something
    // downstream a plaintext it has no reason to distrust.
    const sealed = seal(TOKEN, ring());
    expect(() => open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, ring())).toThrow();
  });

  it('rejects a modified IV', () => {
    const sealed = seal(TOKEN, ring());
    expect(() => open({ ...sealed, iv: flip(sealed.iv) }, ring())).toThrow();
  });

  it('rejects a modified auth tag', () => {
    const sealed = seal(TOKEN, ring());
    expect(() => open({ ...sealed, tag: flip(sealed.tag) }, ring())).toThrow();
  });

  it('rejects a ciphertext sealed with a different key', () => {
    const sealed = seal(TOKEN, { current: { version: 1, key: k(9) } });
    expect(() => open(sealed, ring())).toThrow();
  });

  it('rejects a row whose parts came from two different seals', () => {
    // Splicing: a row is a set of columns, and an attacker with write access
    // can mix them. The tag covers the ciphertext, so this must not decrypt.
    const a = seal('FAKE CREDENTIAL — aaaa', ring());
    const b = seal('FAKE CREDENTIAL — bbbb', ring());
    expect(() => open({ ...a, tag: b.tag }, ring())).toThrow();
    expect(() => open({ ...a, ciphertext: b.ciphertext }, ring())).toThrow();
  });
});

describe('rotation', () => {
  const rotated = {
    current: { version: 2, key: k(2) },
    previous: [{ version: 1, key: k(7) }],
  };

  it('reads a credential sealed with the retired key', () => {
    // Rotation is not atomic: rows keep the old version until something
    // rewrites them. Without this, rotating is an outage.
    const old = seal(TOKEN, ring(1));
    expect(open(old, rotated)).toBe(TOKEN);
  });

  it('writes new credentials with the current key', () => {
    expect(seal(TOKEN, rotated).keyVersion).toBe(2);
  });

  it('says which rows still need re-sealing', () => {
    // Without this a retired key stays load-bearing for ever and "rotated"
    // just means "added a key".
    expect(needsRotation(seal(TOKEN, ring(1)), rotated)).toBe(true);
    expect(needsRotation(seal(TOKEN, rotated), rotated)).toBe(false);
  });

  it('re-sealing makes the old key droppable', () => {
    const old = seal(TOKEN, ring(1));
    const fresh = seal(open(old, rotated), rotated);
    expect(open(fresh, { current: rotated.current })).toBe(TOKEN);
  });

  it('fails loudly on a version the ring does not have', () => {
    expect(() => open({ ...seal(TOKEN, ring(1)), keyVersion: 99 }, rotated)).toThrow(
      /no key for version 99/,
    );
  });
});

describe('the ring from the environment', () => {
  it('carries the previous key when one is set', () => {
    const r = ringFromEnv({
      ENCRYPTION_KEY: k(2).toString('base64'),
      ENCRYPTION_KEY_VERSION: 2,
      ENCRYPTION_KEY_PREVIOUS: k(7).toString('base64'),
    });
    expect(r.current.version).toBe(2);
    expect(r.previous?.[0]?.version).toBe(1);
    expect(open(seal(TOKEN, ring(1)), r)).toBe(TOKEN);
  });

  it('has no previous key when none is set', () => {
    const r = ringFromEnv({ ENCRYPTION_KEY: k(2).toString('base64'), ENCRYPTION_KEY_VERSION: 1 });
    expect(r.previous).toBeUndefined();
  });

  it('works with a real random key', () => {
    const key = randomBytes(32).toString('base64');
    const r = ringFromEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_VERSION: 1 });
    expect(open(seal(TOKEN, r), r)).toBe(TOKEN);
  });
});

describe('comparing secrets', () => {
  it('matches equal values and rejects unequal ones', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});
