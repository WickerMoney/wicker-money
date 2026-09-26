import type { ClassifiedRow } from '../../shared/index.js'
import type { NewLedgerRow } from '../repository/NewLedgerRow.js'
import type { RuleForMatching } from '../repository/RuleForMatching.js'
import type { CategoryResolver } from './CategoryResolver.js'

/**
 * Turns the rows to import into ledger rows, categorised in memory.
 *
 * @param rows - The classified rows chosen for import.
 * @param rules - The user's rules, read once for the whole batch.
 * @param resolveCategory - The host's rule engine.
 * @returns One ledger row per input row, in the same order.
 */
export function toLedgerRows(
  rows: readonly ClassifiedRow[],
  rules: readonly RuleForMatching[],
  resolveCategory: CategoryResolver,
): NewLedgerRow[] {
  return rows.map(({ row }) => ({
    amount: row.amount,
    merchant: row.merchant,
    date: row.date,
    notes: row.notes,
    externalId: row.externalId,
    categoryId: resolveCategory(rules, { merchant: row.merchant, notes: row.notes, amount: row.amount }),
  }))
}
