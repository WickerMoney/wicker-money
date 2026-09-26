import type { ColumnIndexes } from './ColumnIndexes.js'
import { negateMoney } from './fields.js'
import type { SourceMapping } from './mapping.js'
import type { MoneyResult } from './MoneyResult.js'
import { readDebitCreditAmount } from './readDebitCreditAmount.js'
import { readSignedAmount } from './readSignedAmount.js'

/**
 * Reads the signed ledger amount of one row under a mapping.
 *
 * A signed source reads one column; a debit/credit source reads exactly one of
 * two. The mapping's `invertAmount` is applied last.
 *
 * @param raw - The row's cells.
 * @param idx - Where each mapped column is.
 * @param mapping - How to read the file.
 * @returns `{ value }` with a signed decimal string, or `{ error }` with the reason.
 */
export function readAmount(
  raw: readonly string[],
  idx: ColumnIndexes,
  mapping: SourceMapping,
): MoneyResult {
  const read =
    mapping.amountStyle === 'debit-credit' ? readDebitCreditAmount(raw, idx) : readSignedAmount(raw, idx)
  if ('error' in read) return read
  return { value: mapping.invertAmount ? negateMoney(read.value) : read.value }
}
