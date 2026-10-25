import type { RateLimitHit, RateLimitStore } from './RateLimitStore.js'

/** Most keys held at once; beyond it the oldest are dropped, so memory stays bounded. */
const DEFAULT_MAX_KEYS = 100_000

interface Entry {
  count: number
  resetAt: number
}

/** Construction options for {@link InMemoryRateLimitStore}. */
export interface InMemoryRateLimitStoreOptions {
  /** The clock, in epoch milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Most keys kept at once. Defaults to 100,000. */
  readonly maxKeys?: number
}

/**
 * Fixed-window counters held in this process's memory.
 *
 * **Per process only.** Each API instance counts on its own, so with N
 * instances behind a load balancer a client can make up to N times the limit,
 * and a restart forgets every count. Fixed windows also let a client spend one
 * window's allowance at its end and the next one's at its start, so the most
 * that can arrive in any one window length is twice the limit.
 *
 * Expired keys are swept as the map grows, and the map never holds more than
 * `maxKeys`: past that the oldest keys are dropped, which can only make the
 * limiter more lenient to the client that lost its count, never refuse anyone.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number
  private readonly maxKeys: number
  private nextSweepAt = 0

  constructor(options: InMemoryRateLimitStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  }

  /** @inheritdoc */
  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = this.now()
    this.sweep(now, windowMs)
    let entry = this.entries.get(key)
    if (entry === undefined || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      // Delete first so a restarted key moves to the back of the insertion order.
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    entry.count += 1
    return Promise.resolve({ count: entry.count, resetsInMs: entry.resetAt - now })
  }

  /** Number of keys currently held (for tests and diagnostics). */
  get size(): number {
    return this.entries.size
  }

  /** Drops expired keys at most once per window, and the oldest keys past the cap. */
  private sweep(now: number, windowMs: number): void {
    if (now >= this.nextSweepAt) {
      this.nextSweepAt = now + windowMs
      for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key)
    }
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }
}
