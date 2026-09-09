import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Stable content fingerprint. Drives the re-embed short-circuit in Phase 2. */
export const contentHash = (content: string): string =>
  createHash('sha256').update(content.trim().replace(/\s+/g, ' '), 'utf8').digest('hex');

/** One-way reference for values we must group by but must not store: IPs, order numbers. */
export const blindIndex = (value: string, salt: string): string =>
  createHash('sha256').update(`${salt}:${value.trim().toLowerCase()}`, 'utf8').digest('hex');

/**
 * Constant-time string comparison. Used by the order-lookup identity gate so
 * that response timing cannot distinguish a wrong email from a missing order.
 */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length alone is not a timing oracle.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};
