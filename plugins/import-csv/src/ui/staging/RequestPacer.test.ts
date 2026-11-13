import { describe, expect, it } from 'vitest'
import { RequestPacer, type PacerClock } from './RequestPacer.js'

/** A clock that only moves when something sleeps. */
function fakeClock(): PacerClock & { readonly elapsed: () => number } {
  let t = 0
  return { now: () => t, sleep: async (ms) => { t += ms }, elapsed: () => t }
}

describe('RequestPacer', () => {
  it('lets a burst through at once and then holds to the rate', async () => {
    const clock = fakeClock()
    const pacer = new RequestPacer(30, 15, clock)
    const at: number[] = []
    for (let i = 0; i < 38; i += 1) {
      await pacer.take()
      at.push(clock.elapsed())
    }
    expect(at.slice(0, 30).every((t) => t === 0)).toBe(true)
    // 8 more at 15 a second is about 533 ms.
    expect(at[37]).toBeGreaterThanOrEqual(520)
    expect(at[37]).toBeLessThanOrEqual(560)
  })

  it('never sends more than the burst plus the rate allows in any window', async () => {
    const clock = fakeClock()
    const pacer = new RequestPacer(30, 15, clock)
    const at: number[] = []
    for (let i = 0; i < 200; i += 1) {
      await pacer.take()
      at.push(clock.elapsed())
    }
    for (let i = 0; i < at.length; i += 1) {
      const j = at.filter((t) => t <= at[i]! + 1000).length - 1
      // The broker's own limit is 40 and 20 a second; a one second window may hold at most 30 + 15 here.
      expect(j - i + 1).toBeLessThanOrEqual(45)
    }
  })

  it('refills while nothing is sent', async () => {
    const clock = fakeClock()
    const pacer = new RequestPacer(2, 10, clock)
    await pacer.take()
    await pacer.take()
    await clock.sleep(1000)
    const before = clock.elapsed()
    await pacer.take()
    await pacer.take()
    expect(clock.elapsed()).toBe(before)
  })

  it('stops waiting when cancelled', async () => {
    const clock = fakeClock()
    const pacer = new RequestPacer(1, 1, clock)
    await pacer.take()
    let cancelled = false
    const waiting = pacer.take(() => cancelled)
    cancelled = true
    await expect(waiting).rejects.toThrow('cancelled')
  })
})
