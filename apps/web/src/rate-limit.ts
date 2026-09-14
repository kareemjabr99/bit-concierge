/**
 * Per-visitor request limiting, in memory.
 *
 * The storefront endpoint is unauthenticated by design — anyone who can load
 * the page can send a turn — and every turn costs model quota. On the free
 * tier that quota is 500 requests a day for the whole tenant, so an idle
 * afternoon of someone holding down a key is not a cost problem, it is an
 * availability one: the store's assistant stops answering anybody.
 *
 * In memory, which means per process, which means this does NOT survive a
 * restart or a second instance. That is a real limitation and it is the right
 * trade for Phase 3: one process, one tenant, and a Postgres round trip per
 * message to enforce a limit would cost more than the limit saves. Phase 6
 * moves it to the database alongside the per-conversation caps, which already
 * live there because they must be exact.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request would be allowed. Zero when allowed. */
  retryAfter: number;
  remaining: number;
}

interface Bucket {
  hits: number[];
}

export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  check(key: string): RateLimitResult {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    // Drop what has aged out before counting, so a visitor who stopped an hour
    // ago is not still being charged for it.
    bucket.hits = bucket.hits.filter((at) => at > cutoff);

    if (bucket.hits.length >= this.limit) {
      this.buckets.set(key, bucket);
      const oldest = bucket.hits[0]!;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
        remaining: 0,
      };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfter: 0, remaining: this.limit - bucket.hits.length };
  }

  /**
   * Forgets buckets with nothing live in them.
   *
   * Without this the map is a slow leak keyed on visitor address: every IP
   * that ever sent one message stays until the process restarts. Called on a
   * timer by the server rather than on every request, so a burst does not pay
   * for the sweep.
   */
  sweep(): number {
    const cutoff = this.now() - this.windowMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.hits.every((at) => at <= cutoff)) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
