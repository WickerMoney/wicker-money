import { ImportBusyError } from './ImportBusyError.js'

/** Shortest and longest `Retry-After` the gate suggests, in seconds. */
const MIN_RETRY_SECONDS = 5
const MAX_RETRY_SECONDS = 30

/**
 * Caps how many imports one API process works on at once.
 *
 * An import holds a pooled database connection for as long as it writes, so
 * without a cap a few large files take every connection and the rest of the
 * app waits for one. The gate sits in front of the transaction: a request that
 * has to wait holds nothing but its own HTTP connection, and takes a database
 * connection only after its turn comes.
 *
 * A request waits at most `maxWaitMs`; after that it is refused with
 * {@link ImportBusyError} instead of queueing without end behind a reverse
 * proxy that would cut it off anyway. A wait of `0` refuses at once when every
 * slot is busy.
 *
 * This is per process. With several API instances each has its own gate, so
 * the database sees up to `limit` imports per instance.
 */
export class ImportGate {
  private active = 0
  private readonly waiting: Array<() => void> = []

  /**
   * @param limit - Imports running at once (at least 1).
   * @param maxWaitMs - Longest a request waits for a slot, in milliseconds (0 or more).
   */
  constructor(private readonly limit: number, private readonly maxWaitMs: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('ImportGate limit must be a positive integer.')
    if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) throw new Error('ImportGate wait must not be negative.')
  }

  /**
   * Runs `work` once a slot is free.
   *
   * @param work - The import; it should open its database transaction itself.
   * @returns Whatever `work` resolves to. A rejection propagates and still frees the slot.
   * @throws {ImportBusyError} When no slot came free within the wait.
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.release()
    }
  }

  /** Takes a slot, or waits up to the limit for one to be handed over. */
  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    const waitedSeconds = Math.ceil(this.maxWaitMs / 1000)
    const retry = Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, waitedSeconds))
    if (this.maxWaitMs === 0) throw new ImportBusyError(retry, 0)
    await new Promise<void>((resolve, reject) => {
      const turn = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(turn)
        if (at !== -1) this.waiting.splice(at, 1)
        reject(new ImportBusyError(retry, waitedSeconds))
      }, this.maxWaitMs)
      this.waiting.push(turn)
    })
  }

  /** Hands the slot straight to the longest waiter, or frees it if none wait. */
  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) this.active -= 1
    else next()
  }
}
