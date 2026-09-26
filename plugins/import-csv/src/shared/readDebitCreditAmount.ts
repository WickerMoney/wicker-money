import type { ColumnIndexes } from './ColumnIndexes.js'
import { negateMoney, parseMoney } from './fields.js'
import type { MoneyResult } from './MoneyResult.js'
import { readCell } from './readCell.js'

/**
 * Reads the amount of a row from separate debit and credit columns.
 *
 * Exactly one of the two must be filled. A debit holds a positive number
 * meaning money out, so it is negated.
 *
 * @param raw - The row's cells.
 * @param idx - Where each mapped column is.
 * @returns The signed amount, or an error when neither or both cells are filled or the value is not money.
 */
export function readDebitCreditAmount(raw: readonly string[], idx: ColumnIndexes): MoneyResult {
  const debit = readCell(raw, idx.debit)
  const credit = readCell(raw, idx.credit)
  if (debit === '' && credit === '') return { error: 'no debit or credit value' }
  if (debit !== '' && credit !== '') return { error: 'both debit and credit are filled' }
  const parsed = parseMoney(debit !== '' ? debit : credit)
  if ('error' in parsed) return parsed
  return { value: debit !== '' ? negateMoney(parsed.value) : parsed.value }
}
