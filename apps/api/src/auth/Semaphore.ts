/**
 * Caps how many asynchronous jobs run at once; the rest wait in arrival order.
 *
 * Used to bound memory-hard work (password hashing) so that a burst of
 * requests queues instead of allocating all at once.
 */
export class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  /** @param limit - Maximum jobs running concurrently (at least 1). */
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Semaphore limit must be a positive integer.')
    }
  }

  /**
   * Runs `work` once a slot is free.
   *
   * @param work - The job.
   * @returns Whatever `work` resolves to; a rejection propagates and still frees the slot.
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  /** Takes a slot, waiting for one to be handed over if all are busy. */
  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  /** Hands the slot straight to the longest waiter, or frees it if none wait. */
  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) this.active -= 1
    else next()
  }
}
