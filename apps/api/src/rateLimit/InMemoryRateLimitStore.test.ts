import { describe, expect, it } from 'vitest'
import { InMemoryRateLimitStore } from './InMemoryRateLimitStore.js'

function clock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('InMemoryRateLimitStore', () => {
  it('counts requests per key within a window and reports the time left', async () => {
    const c = clock()
    const store = new InMemoryRateLimitStore({ now: c.now })
    expect(await store.hit('a', 60_000)).toEqual({ count: 1, resetsInMs: 60_000 })
    c.advance(10_000)
    expect(await store.hit('a', 60_000)).toEqual({ count: 2, resetsInMs: 50_000 })
  })

  it('keeps keys apart', async () => {
    const store = new InMemoryRateLimitStore()
    await store.hit('general:user:1', 60_000)
    await store.hit('general:user:1', 60_000)
    expect((await store.hit('general:user:2', 60_000)).count).toBe(1)
    expect((await store.hit('import:user:1', 60_000)).count).toBe(1)
  })

  it('starts a new window once the old one has ended', async () => {
    const c = clock()
    const store = new InMemoryRateLimitStore({ now: c.now })
    await store.hit('a', 1_000)
    await store.hit('a', 1_000)
    c.advance(1_000)
    expect(await store.hit('a', 1_000)).toEqual({ count: 1, resetsInMs: 1_000 })
  })

  it('sweeps expired keys, so a stream of one-off clients does not grow the map', async () => {
    const c = clock()
    const store = new InMemoryRateLimitStore({ now: c.now })
    for (let i = 0; i < 50; i += 1) await store.hit(`ip:${i}`, 1_000)
    expect(store.size).toBe(50)
    c.advance(1_500)
    await store.hit('ip:new', 1_000)
    expect(store.size).toBe(1)
  })

  it('never holds more than maxKeys, dropping the oldest first', async () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 10 })
    for (let i = 0; i < 100; i += 1) await store.hit(`k${i}`, 60_000)
    expect(store.size).toBeLessThanOrEqual(10)
    // The newest key survived with its count.
    expect((await store.hit('k99', 60_000)).count).toBe(2)
  })
})
