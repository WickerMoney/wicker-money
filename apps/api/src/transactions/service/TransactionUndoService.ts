import { DuplicateKeyError } from '../../data/DuplicateKeyError.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { AppError, ConflictError } from '../../errors.js'
import { MAX_LIVE_UNDOS } from './MAX_LIVE_UNDOS.js'
import type { TransactionServiceOptions } from './TransactionServiceOptions.js'
import type { TransactionUndoRestored } from './TransactionUndoRestored.js'

/** The answer for a snapshot that is not there, is not the caller's, or has been purged: all the same, so an id cannot be probed. */
const NOT_THERE = 'That undo is no longer available.'

/**
 * Undo for a deleted transaction (ADR 0016): puts back what
 * {@link TransactionService.remove} saved.
 *
 * The snapshot id is the capability, protected by row-level security: only the
 * signed-in user who deleted can restore, from any of their sessions. Nothing
 * here reads an amount; the rows are copied inside SQL.
 */
export class TransactionUndoService {
  /** Seconds a snapshot stays restorable; `0` means Undo is off. */
  private readonly ttlSeconds: number

  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param options - Settings; with none, Undo is off and every restore answers 404.
   */
  constructor(private readonly uow: UnitOfWork, options: TransactionServiceOptions = {}) {
    this.ttlSeconds = options.undoTtlSeconds ?? 0
  }

  /**
   * Puts back a deleted transaction, or both legs of a deleted transfer, with
   * their splits, their match link and their match dismissals, under their
   * original ids and timestamps. All or nothing: any refusal leaves the
   * snapshot as it was.
   *
   * A match link to a recurring occurrence that is gone is cleared
   * (`relinkedMatch` is then false), and a dismissal of a recurring item that is
   * gone is skipped and counted. The lazy purge of the caller's other expired
   * snapshots runs on success only: an expired snapshot must still answer 410
   * here, which a purge first would turn into 404.
   *
   * @param userId - The signed-in user.
   * @param id - The snapshot id the delete answered with.
   * @returns What was put back.
   * @throws {AppError} 404 `not_found` if Undo is off, or the snapshot does not exist, is not the caller's or has been purged.
   * @throws {ConflictError} 409 `already_undone`, `undo_conflict` (an `external_id` is now used by another transaction) or `undo_unavailable` (an account or category was deleted since).
   * @throws {AppError} 410 `undo_expired` if the snapshot has expired and not yet been purged.
   */
  async restore(userId: string, id: string): Promise<TransactionUndoRestored> {
    if (this.ttlSeconds === 0) throw new AppError(NOT_THERE, 404, 'not_found')
    return this.uow.forUser(userId, async ({ transactionUndos }) => {
      const snapshot = await transactionUndos.lock(id)
      if (snapshot === undefined) throw new AppError(NOT_THERE, 404, 'not_found')
      if (snapshot.restored) throw new ConflictError('That was already undone.', 'already_undone')
      if (snapshot.expired) throw new AppError('It is too late to undo that.', 410, 'undo_expired')

      const missing = await transactionUndos.missingReferences(id)
      if (missing.accounts > 0 || missing.categories > 0) {
        throw new ConflictError(unavailableMessage(missing.accounts > 0, missing.categories > 0), 'undo_unavailable')
      }
      if (await transactionUndos.externalIdTaken(id)) throw new ConflictError(CONFLICT_MESSAGE, 'undo_conflict')

      let counts
      try {
        counts = await transactionUndos.restore(id)
      } catch (error) {
        // Another request took the key between the check and the insert. The
        // whole unit of work rolls back, as for any 409.
        if (error instanceof DuplicateKeyError) throw new ConflictError(CONFLICT_MESSAGE, 'undo_conflict')
        throw error
      }
      await transactionUndos.purgeExpired(id)
      await transactionUndos.enforceCap(MAX_LIVE_UNDOS)
      return counts
    })
  }

  /**
   * Deletes every user's expired snapshots. Called hourly (`startUndoPurge`)
   * for people who deleted once and never came back; the lazy purge on every
   * delete covers everyone else.
   *
   * @returns The number of snapshots deleted.
   */
  purgeExpired(): Promise<number> {
    return this.uow.forSystem(({ transactionUndos }) => transactionUndos.purgeAllExpired())
  }
}

const CONFLICT_MESSAGE =
  'Another transaction on that account now uses the same external id, so this one cannot be restored. ' +
  'Delete the other one first.'

/** The 409 text, naming what is gone. */
function unavailableMessage(account: boolean, category: boolean): string {
  const gone = account && category ? 'an account and a category' : account ? 'an account' : 'a category'
  return `It cannot be restored because ${gone} it used has been deleted since.`
}
