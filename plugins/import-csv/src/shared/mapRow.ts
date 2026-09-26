import type { ColumnIndexes } from './ColumnIndexes.js'
import { parseDate } from './fields.js'
import type { MappedRow, RowError, SourceMapping } from './mapping.js'
import { readAmount } from './readAmount.js'
import { readCell } from './readCell.js'

/**
 * Maps one data row, or explains why it cannot be mapped.
 *
 * Checks run in a fixed order (date, description, amount) and stop at the
 * first failure, so a row reports one reason. Merchant, notes and external id
 * are truncated to 300, 1000 and 255 characters.
 *
 * @param raw - The row's cells.
 * @param rowNumber - The 1-based row number counting the header.
 * @param idx - Where each mapped column is.
 * @param mapping - How to read the file.
 * @returns The mapped row, or a `RowError` (recognisable by its `field`).
 */
export function mapRow(
  raw: readonly string[],
  rowNumber: number,
  idx: ColumnIndexes,
  mapping: SourceMapping,
): MappedRow | RowError {
  const fail = (field: string, reason: string): RowError => ({ rowNumber, field, reason, raw })

  if (idx.date === -1) return fail('date', 'no date column is mapped')
  const date = parseDate(raw[idx.date] ?? '', mapping.dateFormat)
  if ('error' in date) return fail('date', `${raw[idx.date] ?? ''} ${date.error}`)

  if (idx.merchant === -1) return fail('merchant', 'no description column is mapped')
  const merchant = readCell(raw, idx.merchant)
  if (merchant === '') return fail('merchant', 'description is empty')

  const amount = readAmount(raw, idx, mapping)
  if ('error' in amount) return fail('amount', amount.error)

  const notes = readCell(raw, idx.notes)
  const externalId = readCell(raw, idx.externalId)
  return {
    rowNumber,
    date: date.value,
    merchant: merchant.slice(0, 300),
    amount: amount.value,
    notes: notes === '' ? null : notes.slice(0, 1000),
    externalId: externalId === '' ? null : externalId.slice(0, 255),
    raw,
  }
}
