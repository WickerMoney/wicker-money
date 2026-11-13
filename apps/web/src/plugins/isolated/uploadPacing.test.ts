import { describe, expect, it } from 'vitest'
import { DEFAULT_BROKER_LIMITS } from './broker.js'
import { RateLimiter } from './RateLimiter.js'

/**
 * The staged CSV upload's planned sender against the broker's limits.
 *
 * The sender is not written yet (the Import CSV frame ports in a later change),
 * so this tests the protocol's arithmetic, not a UI: a model of 6 requests in
 * flight, each answered after one round trip, charged to the broker's real
 * token bucket on a clock the test drives. A 100,000-row file is `begin`, 36
 * chunks of about 200,000 characters and `finish`: 38 messages, then `analyze`
 * and `commit`. The numbers it prints are the ones quoted in the pull request.
 */

const { burst, perSecond, maxInFlight, maxStrikes, strikeWindowMs } = DEFAULT_BROKER_LIMITS
const UPLOAD_MESSAGES = 1 + 36 + 1
const WORKERS = 6

interface Run {
  /** Messages the broker refused as too fast (each is also a strike). */
  readonly refused: number
  /** Most requests in flight at once. */
  readonly peak: number
  /** Milliseconds from the first send to the last answer. */
  readonly ms: number
}

/**
 * Sends `total` messages with `WORKERS` in flight against the broker's bucket.
 *
 * @param rtt - Milliseconds from a send to its answer.
 * @param prior - Tokens the page already spent in the same second (its own first requests).
 * @param gate - A sender-side limit in messages per second (with a burst of 5), or 0 for none.
 * @param retryMs - How long a refused message waits before it is sent again.
 */
function simulate(rtt: number, prior: number, gate: number, retryMs = 250, total = UPLOAD_MESSAGES + 2): Run {
  let t = 0
  const broker = new RateLimiter(burst, perSecond, () => t)
  const own = gate === 0 ? null : new RateLimiter(5, gate, () => t)
  for (let i = 0; i < prior; i += 1) broker.tryTake()
  const busyUntil: number[] = Array<number>(WORKERS).fill(0)
  const readyAt: number[] = Array<number>(WORKERS).fill(0)
  let started = 0
  let done = 0
  let refused = 0
  let peak = 0
  let last = 0
  const finishes: number[] = []
  for (; t < 600_000 && done < total; t += 1) {
    for (let w = 0; w < WORKERS && started < total; w += 1) {
      if (busyUntil[w] as number > t || readyAt[w] as number > t) continue
      if (own !== null && !own.tryTake()) continue
      if (broker.tryTake()) {
        started += 1
        busyUntil[w] = t + rtt
        finishes.push(t + rtt)
      } else {
        refused += 1
        readyAt[w] = t + retryMs
      }
    }
    peak = Math.max(peak, busyUntil.filter((b) => b > t).length)
    done = finishes.filter((f) => f <= t).length
    last = t
  }
  return { refused, peak, ms: last }
}

describe('the broker against the planned sender', () => {
  it('has the limits the plan assumes: a burst of 40, 20 a second, 12 in flight, 256 KiB bodies', () => {
    expect([burst, perSecond, maxInFlight, DEFAULT_BROKER_LIMITS.maxBodyBytes]).toEqual([40, 20, 12, 256 * 1024])
  })

  it('takes a whole upload, analyze and commit inside the burst when the page has been quiet, at any round-trip time', () => {
    const table: Record<string, Run> = {}
    for (const rtt of [5, 20, 50, 150, 400]) {
      const run = simulate(rtt, 0, 0)
      table[`rtt ${rtt} ms`] = run
      expect(run.refused, `rtt ${rtt}`).toBe(0)
      expect(run.peak, `rtt ${rtt}`).toBeLessThanOrEqual(WORKERS)
      expect(run.peak).toBeLessThanOrEqual(maxInFlight)
    }
    console.log(`PACING quiet page, 6 in flight, 40 messages: ${JSON.stringify(table)}`)
  })

  it('refuses part of a fast upload when the page spent its own burst first, never enough to end the connection, and not at all when the sender holds itself to 15 a second', () => {
    const table: Record<string, { naive: Run; paced: Run }> = {}
    for (const rtt of [5, 20, 50, 150]) {
      const naive = simulate(rtt, 12, 0)
      const paced = simulate(rtt, 12, 15)
      table[`rtt ${rtt} ms, 12 spent`] = { naive, paced }
      // Refusals are strikes (`maxStrikes` in `strikeWindowMs` ends the connection); one upload stays far below it.
      expect(naive.refused, `naive ${rtt}`).toBeLessThan(maxStrikes)
      expect(paced.refused, `paced ${rtt}`).toBe(0)
    }
    // With a 5 ms round trip the burst is gone before any token comes back, so the naive sender is refused.
    expect(simulate(5, 12, 0).refused).toBeGreaterThan(0)
    // A sender that backs off 250 ms on a refusal finishes, and its strikes stay inside the window's budget.
    const retried = simulate(5, 12, 0, 250)
    expect(retried.ms).toBeLessThan(strikeWindowMs)
    console.log(`PACING page spent 12 of 40 first: ${JSON.stringify(table)}`)
  })

  it('paces a sustained sender at 15 a second to 15 messages a second, under the 20 the broker allows once the burst is gone', () => {
    // Three uploads in a row, 38 messages each, from a quiet page.
    const run = simulate(20, 0, 15, 250, 3 * UPLOAD_MESSAGES)
    expect(run.refused).toBe(0)
    // 114 messages: 5 free from the gate's burst, the rest at 15 a second.
    expect(run.ms).toBeGreaterThan(((3 * UPLOAD_MESSAGES - 5) / 15) * 1000 - 500)
    console.log(`PACING 3 uploads in a row at 15 a second: ${JSON.stringify(run)}`)
  })
})
