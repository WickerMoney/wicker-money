import type { ClassifiedRow } from '../../shared/index.js'
import type { AnalyzedRow } from './AnalyzedRow.js'

/**
 * Flattens a classified row into its response shape.
 *
 * @param c - The classified row.
 * @returns The row's fields together with its verdict.
 */
export function toAnalyzedRow(c: ClassifiedRow): AnalyzedRow {
  return {
    rowNumber: c.row.rowNumber,
    date: c.row.date,
    merchant: c.row.merchant,
    amount: c.row.amount,
    notes: c.row.notes,
    externalId: c.row.externalId,
    status: c.status,
    reason: c.reason,
    matched: c.matched,
  }
}
