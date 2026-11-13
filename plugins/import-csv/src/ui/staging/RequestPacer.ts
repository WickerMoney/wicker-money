import { PACE_BURST, PACE_PER_SECOND } from './stagingLimits.js'

/** What a pacer needs from the world, replaceable in a test. */
export interface PacerClock {
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const realClock: PacerClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Holds requests back so the frame does not trip the host's per-frame limit.
 *
 * A token bucket on the plugin's side of the broker: `burst` requests may go at
 * once and the bucket refills at `perSecond`. The broker's own bucket is larger
 * (40 and 20 a second); this one is smaller on purpose, so the page's other
 * messages (its reads, its size reports) still fit, and a refusal from the
 * broker, which counts as a strike against the frame, never happens.
 */
export class RequestPacer {
  private tokens: number
  private last: number

  /**
   * @param burst - Requests that may go at once.
   * @param perSecond - Refill rate.
   * @param clock - Time and waiting; the real ones by default.
   */
  constructor(
    private readonly burst: number = PACE_BURST,
    private readonly perSecond: number = PACE_PER_SECOND,
    private readonly clock: PacerClock = realClock,
  ) {
    this.tokens = burst
    this.last = clock.now()
  }

  /**
   * Resolves when one more request may be sent.
   *
   * @param isCancelled - Checked after each wait; when it says so the wait ends with a rejection.
   * @throws {Error} When `isCancelled` returns true.
   */
  async take(isCancelled: () => boolean = () => false): Promise<void> {
    for (;;) {
      if (isCancelled()) throw new Error('cancelled')
      const now = this.clock.now()
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond)
      this.last = now
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await this.clock.sleep(Math.ceil(((1 - this.tokens) / this.perSecond) * 1000))
    }
  }
}
