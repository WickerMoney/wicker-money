import { columnIndex } from './columnIndex.js'
import type { ColumnIndexes } from './ColumnIndexes.js'
import type { ColumnMap } from './mapping.js'

/**
 * Resolves every mapped header name to its position in the file.
 *
 * @param headers - The CSV's header names.
 * @param columns - The mapping's header names.
 * @returns The position of each mapped column.
 */
export function readColumnIndexes(headers: readonly string[], columns: ColumnMap): ColumnIndexes {
  return {
    date: columnIndex(headers, columns.date),
    merchant: columnIndex(headers, columns.merchant),
    amount: columnIndex(headers, columns.amount),
    debit: columnIndex(headers, columns.debit),
    credit: columnIndex(headers, columns.credit),
    notes: columnIndex(headers, columns.notes),
    externalId: columnIndex(headers, columns.externalId),
  }
}
