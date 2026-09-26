import type { Transaction } from '../../db/models/index.js'
import type { TransactionCursor } from './TransactionCursor.js'

/**
 * Builds the cursor that resumes a listing right after a row.
 *
 * @param row - The last row of a page.
 * @param sort - The column the listing is sorted on.
 * @param direction - The direction the listing is sorted in.
 * @returns A cursor holding the row's value in the sort column and its id.
 */
export function cursorAfter(
  row: Transaction,
  sort: TransactionCursor['sort'],
  direction: TransactionCursor['direction'],
): TransactionCursor {
  const value = { date: row.transaction_date, amount: row.amount, merchant: row.merchant }[sort]
  return { sort, direction, value, id: row.id }
}
