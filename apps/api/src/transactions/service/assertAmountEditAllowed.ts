import { ConflictError } from '../../errors.js'
import { money } from '../../money.js'
import type { Transaction } from '../../db/models/index.js'
import { assertTransferAmountKeepsDirection } from './assertTransferAmountKeepsDirection.js'

/**
 * Checks that changing a transaction's amount is allowed.
 *
 * An amount equal to the stored one is not a change and is always allowed. A
 * split transaction's amount is locked because its parts were validated against
 * it, and a transfer leg's amount must keep its direction.
 *
 * @param existing - The locked stored row.
 * @param nextAmount - The requested amount, if the edit names one.
 * @throws {ConflictError} If the amount of a split transaction would change.
 * @throws {ValidationError} If the amount of a transfer leg would be zeroed or flip sign.
 */
export function assertAmountEditAllowed(existing: Transaction, nextAmount: string | undefined): void {
  if (nextAmount === undefined || money(nextAmount).equals(money(existing.amount))) return
  if (existing.is_split) {
    throw new ConflictError(
      'This transaction is split, so its amount cannot change while the splits stand. ' +
        'Remove the splits, edit the amount, then split it again.',
      'split_amount_locked',
    )
  }
  if (existing.transfer_id !== null) assertTransferAmountKeepsDirection(existing.amount, nextAmount)
}
