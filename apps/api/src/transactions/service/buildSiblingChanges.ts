import { negate } from '../../money.js'
import type { TransactionChanges } from '../repository/TransactionChanges.js'
import type { TransactionPatch } from './TransactionPatch.js'

/**
 * Works out what an edit to one transfer leg changes on the other leg: the
 * date is shared and the amount is negated.
 *
 * @param patch - The requested edit of the leg.
 * @returns The changes for the sibling, or undefined when the edit touches neither amount nor date.
 */
export function buildSiblingChanges(patch: TransactionPatch): TransactionChanges | undefined {
  if (patch.amount === undefined && patch.transactionDate === undefined) return undefined
  return {
    ...(patch.amount === undefined ? {} : { amount: negate(patch.amount) }),
    ...(patch.transactionDate === undefined ? {} : { transactionDate: patch.transactionDate }),
  }
}
