/** How long a resolved read is served from memory, in milliseconds. */
export const RESPONSE_CACHE_TTL_MS = 5_000

/** The most entries held for one user; the least recently used is dropped first. */
export const RESPONSE_CACHE_MAX_ENTRIES = 50

/** One remembered read: the shared promise, and when it stops being fresh. */
interface Entry {
  readonly promise: Promise<unknown>
  /** `null` while the request is in flight, which never expires. */
  expiresAt: number | null
}

/** Everything remembered for one user. Replaced wholesale on invalidation. */
type Bucket = Map<string, Entry>

/** Options for {@link ResponseCache}. */
export interface ResponseCacheOptions {
  /** Freshness of a resolved read, in milliseconds. */
  readonly ttlMs?: number
  /** Per-user entry cap. */
  readonly maxEntries?: number
  /** The clock; replaceable in tests. */
  readonly now?: () => number
}

/** Builds the error an aborted waiter sees, matching what an aborted `fetch` rejects with. */
function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/**
 * Gives one waiter its own copy of a response.
 *
 * Responses are parsed JSON, so a structured clone is exact. The cache keeps
 * the original and never hands it out, so one caller mutating what it got
 * cannot change what the next caller receives.
 */
function copyOf<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

/**
 * Lets a waiter stop waiting without cancelling the shared request.
 *
 * The request is shared, so one caller's `AbortSignal` must not abort it for
 * the others. The caller that aborted gets an `AbortError`; the request runs on
 * and still fills the cache.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (signal === undefined || signal === null) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * A short-lived, per-user memory of GET responses.
 *
 * Two things happen here. Identical reads that overlap share one request, and a
 * resolved read is served again for a few seconds. Both exist so several
 * widgets asking the same question on one page cost one round trip.
 *
 * The rules that keep this safe:
 *  - Entries live in a bucket per user id and a lookup only ever sees its own
 *    user's bucket, so one user's response cannot reach another's caller.
 *  - Only successes are kept. A failure is shared by the callers already
 *    waiting on it and then forgotten.
 *  - Invalidating a user (or clearing everything) discards the whole bucket. A
 *    request still in flight at that moment finishes for its waiters but does
 *    not write its result back, so a read that began before a write cannot
 *    repopulate the cache with data from before it.
 *  - Every caller receives its own copy.
 *
 * Held in memory only, so a reload starts empty.
 */
export class ResponseCache {
  private readonly buckets = new Map<string, Bucket>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: ResponseCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? RESPONSE_CACHE_TTL_MS
    this.maxEntries = options.maxEntries ?? RESPONSE_CACHE_MAX_ENTRIES
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Returns a fresh or in-flight response for `key`, or loads one.
   *
   * @param userId - Whose bucket to use.
   * @param key - Identifies the read within that user, such as method and full URL.
   * @param load - Starts the request. Called at most once per shared flight, and
   * given no caller's signal, because the request outlives any one caller.
   * @param signal - This caller's own cancellation; only this caller stops waiting.
   * @returns A promise for this caller's own copy of the response.
   */
  read<T>(userId: string, key: string, load: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
    if (signal?.aborted === true) return Promise.reject(abortError())
    const bucket = this.bucketFor(userId)
    const hit = bucket.get(key)
    if (hit !== undefined && (hit.expiresAt === null || hit.expiresAt > this.now())) {
      bucket.delete(key)
      bucket.set(key, hit) // most recently used goes last
      return untilAborted(hit.promise.then(copyOf) as Promise<T>, signal)
    }
    if (hit !== undefined) bucket.delete(key)

    let promise: Promise<T>
    try {
      promise = load()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const entry: Entry = { promise, expiresAt: null }
    bucket.set(key, entry)
    this.trim(bucket)
    entry.promise.then(
      () => {
        if (this.buckets.get(userId) === bucket && bucket.get(key) === entry) {
          entry.expiresAt = this.now() + this.ttlMs
        }
      },
      () => {
        if (bucket.get(key) === entry) bucket.delete(key)
      },
    )
    return untilAborted(entry.promise.then(copyOf) as Promise<T>, signal)
  }

  /** Forgets one read, so the next caller fetches it again. */
  forget(userId: string, key: string): void {
    this.buckets.get(userId)?.delete(key)
  }

  /** Drops everything remembered for one user. */
  invalidateUser(userId: string): void {
    this.buckets.delete(userId)
  }

  /** Drops everything for every user. */
  clear(): void {
    this.buckets.clear()
  }

  /** The number of entries held for a user, in flight or resolved. */
  size(userId: string): number {
    return this.buckets.get(userId)?.size ?? 0
  }

  private bucketFor(userId: string): Bucket {
    let bucket = this.buckets.get(userId)
    if (bucket === undefined) {
      bucket = new Map()
      this.buckets.set(userId, bucket)
    }
    return bucket
  }

  /** Evicts least recently used entries until the bucket fits. */
  private trim(bucket: Bucket): void {
    while (bucket.size > this.maxEntries) {
      const oldest = bucket.keys().next()
      if (oldest.done === true) return
      bucket.delete(oldest.value)
    }
  }
}

/** The cache shared by the host's scoped clients. */
export const responseCache = new ResponseCache()
