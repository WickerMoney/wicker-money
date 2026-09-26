import type { Transaction } from '../../db/models/index.js'
import { NotFoundError } from '../../errors.js'
import type { TransactionRepository } from '../repository/TransactionRepository.js'

/**
 * Locks the row being edited and, for a transfer, both of its legs.
 *
 * Lock, then trust only what the lock returns: the unlocked read that found
 * the row may predate a concurrent edit.
 *
 * @param transactions - Repository used for the locks.
 * @param probe - The row as read before locking.
 * @returns The locked row and all locked transfer legs (empty for an ordinary transaction).
 * @throws {NotFoundError} If the row no longer exists once locked.
 */
export async function lockForEdit(
  transactions: Pick<TransactionRepository, 'lockById' | 'lockTransferLegs'>,
  probe: Transaction,
): Promise<{ readonly existing: Transaction; readonly legs: readonly Transaction[] }> {
  const legs = probe.transfer_id === null ? [] : await transactions.lockTransferLegs(probe.transfer_id)
  const existing =
    probe.transfer_id === null ? await transactions.lockById(probe.id) : legs.find((l) => l.id === probe.id)
  if (existing === undefined) throw new NotFoundError('Transaction')
  return { existing, legs }
}
