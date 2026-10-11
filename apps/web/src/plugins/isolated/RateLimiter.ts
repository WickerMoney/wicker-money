/**
 * A token bucket: allows bursts up to a capacity and a steady rate after that.
 *
 * The broker uses one per frame to bound what a misbehaving plugin can ask of
 * the host and the API. Plain arithmetic on an injected clock, so it needs no
 * timers and a test can drive it.
 */
export class RateLimiter {
  private tokens: number
  private last: number

  /**
   * @param capacity - Most tokens held, and the size of the largest burst.
   * @param refillPerSecond - Tokens added per second while below capacity.
   * @param now - The clock in epoch milliseconds.
   */
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity
    this.last = now()
  }

  /**
   * Takes tokens if there are enough.
   *
   * @param cost - How many tokens this action costs.
   * @returns `true` when the action may go ahead.
   */
  tryTake(cost = 1): boolean {
    const t = this.now()
    const elapsed = Math.max(0, t - this.last)
    this.last = t
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSecond)
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}
