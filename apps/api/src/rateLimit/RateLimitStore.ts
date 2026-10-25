/** What a store reports after counting one request. */
export interface RateLimitHit {
  /** Requests counted against the key in the current window, including this one. */
  readonly count: number
  /** Milliseconds until the window the key is in ends and its count starts again from zero. */
  readonly resetsInMs: number
}

/**
 * Where request counts are kept for the global rate limit.
 *
 * The limiter asks one thing of its store: count this request against a key
 * and say where the key stands. The only implementation is
 * {@link InMemoryRateLimitStore}, which is private to one API process. The
 * interface is deliberately this small so a store shared between API
 * instances (the `RateLimitStore` port in the draft ADR 0011) can replace it
 * without touching the limiter; nothing here is that port yet.
 */
export interface RateLimitStore {
  /**
   * Counts one request against `key` in a fixed window of `windowMs`.
   *
   * @param key - What is being limited (a bucket name plus a user or address).
   * @param windowMs - Length of the window, in milliseconds. A key's window
   *   starts at its first request and a new one starts after it ends.
   * @returns The count so far in this window and the time left in it.
   */
  hit(key: string, windowMs: number): Promise<RateLimitHit>
}
