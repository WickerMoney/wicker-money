import type { UndoSnapshotKind } from '../../db/models/index.js'
import type { UndoMissingReferences } from './UndoMissingReferences.js'
import type { UndoRestoreCounts } from './UndoRestoreCounts.js'
import type { UndoSnapshot } from './UndoSnapshot.js'
import type { UndoSnapshotState } from './UndoSnapshotState.js'

/**
 * Persistence for transaction Undo snapshots (ADR 0016).
 *
 * Every payload is built and read back inside SQL. No amount is ever selected
 * into Node, so none can become a JavaScript number.
 */
export interface TransactionUndoRepository {
  /**
   * Copies the given transactions, their splits and their match dismissals into
   * a new snapshot that expires `ttlSeconds` from now. Call it before deleting
   * them, in the same transaction, with the rows locked.
   *
   * Writes nothing when the payload would be over the size cap, so a delete
   * never fails because its snapshot was too big.
   *
   * @param input - The owner, what the ids are, the ids, and the time to live.
   * @returns The snapshot, or undefined when nothing was written (over the cap, or no such rows).
   */
  capture(input: {
    readonly userId: string
    readonly kind: UndoSnapshotKind
    readonly transactionIds: readonly string[]
    readonly ttlSeconds: number
  }): Promise<UndoSnapshot | undefined>

  /**
   * Deletes the caller's expired snapshots.
   *
   * @param exceptId - A snapshot to leave alone even if it has expired.
   * @returns The number deleted.
   */
  purgeExpired(exceptId?: string): Promise<number>

  /**
   * Keeps the caller's newest `limit` live snapshots (not restored, not
   * expired) and deletes the older ones.
   *
   * @param limit - How many live snapshots may remain.
   * @returns The number deleted.
   */
  enforceCap(limit: number): Promise<number>

  /**
   * Reads a snapshot and locks it (`FOR UPDATE`), so a second restore of the
   * same snapshot waits and then sees the first one's result.
   *
   * @param id - Snapshot id.
   * @returns Its state, or undefined if it does not exist, is not the caller's, or was purged.
   */
  lock(id: string): Promise<UndoSnapshotState | undefined>

  /**
   * @param id - Snapshot id (already locked by the caller).
   * @returns How many accounts and categories it names that no longer exist.
   */
  missingReferences(id: string): Promise<UndoMissingReferences>

  /**
   * @param id - Snapshot id (already locked by the caller).
   * @returns Whether another transaction now holds the `(account_id, external_id)` of one of its rows.
   */
  externalIdTaken(id: string): Promise<boolean>

  /**
   * Inserts the snapshot's transactions, splits and dismissals with their
   * original ids and timestamps, then marks the snapshot restored and empties
   * its payload. A match link to an occurrence that no longer exists is
   * cleared; a dismissal of a recurring item that no longer exists is skipped.
   *
   * @param id - Snapshot id (already locked and checked by the caller).
   * @returns What was put back.
   * @throws {DuplicateKeyError} If an `(account_id, external_id)` was taken after the check.
   */
  restore(id: string): Promise<UndoRestoreCounts>

  /**
   * Deletes every expired snapshot of every user, through the owner-run
   * `core.purge_expired_transaction_undos()`. Needs no user context.
   *
   * @returns The number deleted.
   */
  purgeAllExpired(): Promise<number>
}
