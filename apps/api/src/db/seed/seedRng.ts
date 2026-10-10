/**
 * @module
 * A deterministic pseudo-random generator and date helpers for the dev seed.
 *
 * Every persona's dataset is generated from a fixed numeric seed (derived from
 * its key), so `pnpm seed` produces the same accounts, transactions and
 * amounts on every run. That matters for two reasons: a screenshot or a
 * recording taken today should still match the data after a `--reset` and
 * re-seed next week, and a bug reproduced against seeded data should stay
 * reproduced. `Math.random()` would defeat both.
 *
 * Dates are always computed relative to "today" (the seed's `todayIso`),
 * never hardcoded, so the recurring-items widget and the "through the next
 * payday" window always have real data in front of them, however long ago
 * the data was seeded.
 */

/** A seeded, deterministic random source (mulberry32). Same seed, same sequence, every run. */
export class SeedRng {
  private state: number

  /** @param seed - Any 32-bit integer. Two `SeedRng`s with the same seed produce the same sequence. */
  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** @returns The next float in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /**
   * @param min - Inclusive lower bound.
   * @param max - Inclusive upper bound.
   * @returns A random integer in `[min, max]`.
   */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /**
   * @param min - Inclusive lower bound.
   * @param max - Inclusive upper bound.
   * @param decimals - Decimal places to round to (default 2, matching real-world prices).
   * @returns A random decimal string suitable as a money amount (unsigned).
   */
  amount(min: number, max: number, decimals = 2): string {
    const value = this.next() * (max - min) + min
    return value.toFixed(decimals)
  }

  /**
   * @param items - Non-empty array to choose from.
   * @returns One element, chosen deterministically from this generator's sequence.
   */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() needs a non-empty array')
    return items[this.int(0, items.length - 1)]!
  }

  /**
   * @returns `true` with probability `p` (0 to 1).
   */
  chance(p: number): boolean {
    return this.next() < p
  }
}

/**
 * Derives a stable 32-bit seed from a string, so each persona gets its own
 * reproducible generator without a shared counter to keep in sync.
 *
 * @param key - Any string (a persona key works well).
 * @returns A 32-bit integer seed.
 */
export function seedFrom(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** `YYYY-MM-DD` for a `Date`, in UTC (the seed never depends on the host machine's local time zone). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Today, at UTC midnight, as `YYYY-MM-DD`. Every relative date in the seed is computed from this. */
export function todayIso(): string {
  const now = new Date()
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
}

/**
 * @param iso - `YYYY-MM-DD`.
 * @returns The last day of that same month, as `YYYY-MM-DD`.
 */
export function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number, number]
  return isoDate(new Date(Date.UTC(y, m, 0)))
}

/**
 * @param iso - `YYYY-MM-DD`.
 * @returns The first day of that same month, as `YYYY-MM-DD`.
 */
export function firstDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number, number]
  return isoDate(new Date(Date.UTC(y, m - 1, 1)))
}
