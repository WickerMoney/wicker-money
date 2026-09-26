import type { BatchOutcome } from './BatchOutcome.js'
import type { BatchListRow } from './BatchListRow.js'
import type { BatchRecord } from './BatchRecord.js'
import type { NewBatch } from './NewBatch.js'

/** Storage of import batches. */
export interface BatchRepository {
  /**
   * Lists the user's most recent batches.
   *
   * @param limit - The maximum number of batches.
   * @returns Batches with their account names, newest first.
   */
  listRecent(limit: number): Promise<BatchListRow[]>

  /**
   * Records a new batch.
   *
   * @param batch - The counters and identity of the import.
   * @returns The new batch id, or `undefined` if the database returned none.
   * @throws A PostgreSQL unique violation when `batch.idempotencyKey` is
   *   already recorded on another of the user's batches.
   */
  create(batch: NewBatch): Promise<string | undefined>

  /**
   * Finds the user's batch recorded under an idempotency key.
   *
   * @param key - The client's idempotency key.
   * @returns The batch's recorded outcome, or `undefined` when no batch has that key.
   */
  findByIdempotencyKey(key: string): Promise<BatchOutcome | undefined>

  /**
   * Finds one of the user's batches.
   *
   * @param id - The batch id.
   * @returns The batch, or `undefined` when it does not exist or belongs to someone else.
   */
  findById(id: string): Promise<BatchRecord | undefined>

  /**
   * Marks a batch reverted as of now.
   *
   * @param id - The batch id.
   */
  markReverted(id: string): Promise<void>
}
