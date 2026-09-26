import type { TransactionChanges } from '../repository/TransactionChanges.js'
import { buildCategoryChanges } from './buildCategoryChanges.js'
import type { TransactionPatch } from './TransactionPatch.js'

/**
 * Turns an edit request into the columns to write, leaving out fields the
 * request does not name.
 *
 * @param patch - The requested edit.
 * @returns The changes for the edited row.
 */
export function buildTransactionChanges(patch: TransactionPatch): TransactionChanges {
  return {
    ...(patch.amount === undefined ? {} : { amount: patch.amount }),
    ...(patch.merchant === undefined ? {} : { merchant: patch.merchant }),
    ...(patch.transactionDate === undefined ? {} : { transactionDate: patch.transactionDate }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...buildCategoryChanges(patch.categoryId),
  }
}
