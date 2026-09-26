import type { ColumnIndexes } from './ColumnIndexes.js'
import { parseMoney } from './fields.js'
import type { MoneyResult } from './MoneyResult.js'

/**
 * Reads the amount of a row from the single signed amount column.
 *
 * @param raw - The row's cells.
 * @param idx - Where each mapped column is.
 * @returns The parsed amount, or an error when no amount column is mapped or the cell is not money.
 */
export function readSignedAmount(raw: readonly string[], idx: ColumnIndexes): MoneyResult {
  if (idx.amount === -1) return { error: 'no amount column is mapped' }
  return parseMoney(raw[idx.amount] ?? '')
}
