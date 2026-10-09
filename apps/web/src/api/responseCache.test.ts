import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseCache } from './responseCache.js'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const KEY = 'GET /core/transactions/monthly-summary?months=12'

let cache: ResponseCache

beforeEach(() => {
  vi.useFakeTimers()
  cache = new ResponseCache({ ttlMs: 5_000, maxEntries: 3 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sharing an in-flight read', () => {
  it('sends one request for concurrent identical reads and resolves every waiter', async () => {
    const flight = deferred<{ rows: string[] }>()
    const load = vi.fn(() => flight.promise)

    const waiters = [cache.read('u1', KEY, load), cache.read('u1', KEY, load), cache.read('u1', KEY, load)]
    flight.resolve({ rows: ['a'] })

    await expect(Promise.all(waiters)).resolves.toEqual([{ rows: ['a'] }, { rows: ['a'] }, { rows: ['a'] }])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not share different URLs', async () => {
    const load = vi.fn(async () => ({}))
    await cache.read('u1', 'GET /a?months=3', load)
    await cache.read('u1', 'GET /a?months=12', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives each waiter its own copy', async () => {
    const load = vi.fn(async () => ({ rows: [{ total: '1.00' }] }))

    const [first, second] = await Promise.all([cache.read('u1', KEY, load), cache.read('u1', KEY, load)])
    first.rows[0]!.total = 'tampered'
    first.rows.push({ total: '9.00' })
    const third = await cache.read('u1', KEY, load)

    expect(second).toEqual({ rows: [{ total: '1.00' }] })
    expect(third).toEqual({ rows: [{ total: '1.00' }] })
    expect(first).not.toBe(second)
  })

  it('lets one waiter abort without cancelling the others or the request', async () => {
    const flight = deferred<string>()
    const load = vi.fn((): Promise<string> => flight.promise)
    const controller = new AbortController()

    const aborted = cache.read('u1', KEY, load, controller.signal)
    const patient = cache.read('u1', KEY, load)
    controller.abort()
    flight.resolve('ok')

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    await expect(patient).resolves.toBe('ok')
    await cache.read('u1', KEY, load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('rejects at once for a signal that is already aborted, without a request', async () => {
    const load = vi.fn(async () => 'x')
    const controller = new AbortController()
    controller.abort()

    await expect(cache.read('u1', KEY, load, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(load).not.toHaveBeenCalled()
  })
})

describe('the short TTL', () => {
  it('serves a resolved read from memory until the TTL passes, then refetches', async () => {
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await expect(cache.read('u1', KEY, load)).resolves.toBe('first')
    vi.advanceTimersByTime(4_999)
    await expect(cache.read('u1', KEY, load)).resolves.toBe('first')
    expect(load).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await expect(cache.read('u1', KEY, load)).resolves.toBe('second')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not start the TTL clock until the request resolves', async () => {
    const flight = deferred<string>()
    const load = vi.fn(() => flight.promise)

    const first = cache.read('u1', KEY, load)
    vi.advanceTimersByTime(60_000) // a slow request is still in flight, not expired
    const second = cache.read('u1', KEY, load)
    flight.resolve('slow')

    await expect(Promise.all([first, second])).resolves.toEqual(['slow', 'slow'])
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('the clock', () => {
  it('is read at call time, so a cache built before fake timers still follows them', async () => {
    vi.useRealTimers()
    const early = new ResponseCache({ ttlMs: 5_000 })
    vi.useFakeTimers()
    const load = vi.fn(async () => 'v')

    await early.read('u1', KEY, load)
    vi.advanceTimersByTime(5_000)
    await early.read('u1', KEY, load)

    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('errors', () => {
  it('shares a failure with the callers already waiting, then evicts it', async () => {
    const flight = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(flight.promise).mockResolvedValueOnce('recovered')

    const waiters = [cache.read('u1', KEY, load), cache.read('u1', KEY, load)]
    const settled = Promise.allSettled(waiters)
    flight.reject(new Error('boom'))

    const results = await settled
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(cache.size('u1')).toBe(0)
    await expect(cache.read('u1', KEY, load)).resolves.toBe('recovered')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reports a synchronous throw from load as a rejection and keeps nothing', async () => {
    const load = vi.fn((): Promise<string> => { throw new Error('sync') })
    await expect(cache.read('u1', KEY, load)).rejects.toThrow('sync')
    expect(cache.size('u1')).toBe(0)
  })
})

describe('the size cap', () => {
  it('evicts the least recently used entry beyond the cap', async () => {
    const load = vi.fn(async () => 'v')
    await cache.read('u1', 'GET /1', load)
    await cache.read('u1', 'GET /2', load)
    await cache.read('u1', 'GET /3', load)
    await cache.read('u1', 'GET /1', load) // touch: /2 is now the oldest
    await cache.read('u1', 'GET /4', load) // over the cap: /2 goes
    expect(cache.size('u1')).toBe(3)
    expect(load).toHaveBeenCalledTimes(4)

    await cache.read('u1', 'GET /1', load)
    await cache.read('u1', 'GET /3', load)
    await cache.read('u1', 'GET /4', load)
    expect(load).toHaveBeenCalledTimes(4) // all still cached

    await cache.read('u1', 'GET /2', load)
    expect(load).toHaveBeenCalledTimes(5) // evicted, fetched again
  })

  it('counts the cap per user, so one busy user cannot evict another', async () => {
    const load = vi.fn(async () => 'v')
    await cache.read('u2', 'GET /only', load)
    for (const n of [1, 2, 3, 4, 5]) await cache.read('u1', `GET /${n}`, load)

    expect(cache.size('u2')).toBe(1)
    expect(cache.size('u1')).toBe(3)
  })
})

describe('invalidation', () => {
  it("drops all of a user's entries, whatever the endpoint, and nobody else's", async () => {
    const load = vi.fn(async () => 'v')
    await cache.read('u1', 'GET /a', load)
    await cache.read('u1', 'GET /b', load)
    await cache.read('u2', 'GET /a', load)
    expect(load).toHaveBeenCalledTimes(3)

    cache.invalidateUser('u1')

    await cache.read('u1', 'GET /a', load)
    await cache.read('u1', 'GET /b', load)
    expect(load).toHaveBeenCalledTimes(5)
    await cache.read('u2', 'GET /a', load)
    expect(load).toHaveBeenCalledTimes(5)
  })

  it('clear drops every user', async () => {
    const load = vi.fn(async () => 'v')
    await cache.read('u1', KEY, load)
    await cache.read('u2', KEY, load)

    cache.clear()

    expect(cache.size('u1') + cache.size('u2')).toBe(0)
    await cache.read('u1', KEY, load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not let a read that began before invalidation repopulate the cache', async () => {
    const stale = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce('fresh')

    const early = cache.read('u1', KEY, load) // began before the write
    cache.invalidateUser('u1') // the write
    stale.resolve('stale')

    await expect(early).resolves.toBe('stale') // its own waiter still gets what it asked for
    await expect(cache.read('u1', KEY, load)).resolves.toBe('fresh')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('forget drops one entry and ignores a completion of the forgotten flight', async () => {
    const old = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce('new')

    void cache.read('u1', KEY, load)
    cache.forget('u1', KEY)
    old.resolve('old')
    await Promise.resolve()

    await expect(cache.read('u1', KEY, load)).resolves.toBe('new')
  })
})

describe('users never share', () => {
  it('gives user B their own request and answer for the identical URL', async () => {
    const loadA = vi.fn(async () => ({ owner: 'A' }))
    const loadB = vi.fn(async () => ({ owner: 'B' }))

    await expect(cache.read('A', KEY, loadA)).resolves.toEqual({ owner: 'A' })
    await expect(cache.read('B', KEY, loadB)).resolves.toEqual({ owner: 'B' })

    expect(loadA).toHaveBeenCalledTimes(1)
    expect(loadB).toHaveBeenCalledTimes(1)
  })

  it("does not let user B join user A's in-flight request", async () => {
    const flightA = deferred<{ owner: string }>()
    const loadA = vi.fn(() => flightA.promise)
    const loadB = vi.fn(async () => ({ owner: 'B' }))

    const a = cache.read('A', KEY, loadA)
    const b = cache.read('B', KEY, loadB)
    flightA.resolve({ owner: 'A' })

    await expect(b).resolves.toEqual({ owner: 'B' })
    await expect(a).resolves.toEqual({ owner: 'A' })
    expect(loadB).toHaveBeenCalledTimes(1)
  })

  it("survives a mid-flight user switch: A's late answer never reaches B", async () => {
    const flightA = deferred<{ owner: string }>()
    const loadA = vi.fn(() => flightA.promise)
    const loadB = vi.fn(async () => ({ owner: 'B' }))

    const a = cache.read('A', KEY, loadA)
    cache.clear() // the session changes hands while A's request is in flight
    const b = cache.read('B', KEY, loadB)
    flightA.resolve({ owner: 'A' })

    await expect(b).resolves.toEqual({ owner: 'B' })
    await a
    // A's late answer was not written back, and B still sees only B's data.
    await expect(cache.read('B', KEY, loadB)).resolves.toEqual({ owner: 'B' })
    expect(cache.size('A')).toBe(0)
    expect(loadB).toHaveBeenCalledTimes(1)
  })
})
