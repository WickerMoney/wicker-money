import { classifyByExternalId } from './classifyByExternalId.js'
import { classifyByHeuristic } from './classifyByHeuristic.js'
import type { ClassifiedRow } from './ClassifiedRow.js'
import { ExistingIndex } from './ExistingIndex.js'
import type { ExistingTransaction } from './ExistingTransaction.js'
import type { MappedRow } from './mapping.js'

/**
 * Classifies every mapped row against what is already in the account.
 *
 * `existing` should cover the date range of the file plus the match window.
 * Rows are also compared against earlier rows in the same file, so a statement
 * containing its own duplicate is caught before it is written rather than after.
 *
 * A row with an external id is decided by that id alone, so two same-day
 * coffees with distinct ids are not flagged against each other. A row without
 * one is `needs-review` when an existing transaction has the same amount, a
 * similar merchant and a date within `MATCH_WINDOW_DAYS`. Existing transactions
 * are indexed once, so the cost is linear in the two lists rather than their
 * product.
 *
 * @param rows - The mapped rows, in file order.
 * @param existing - Transactions already in the account.
 * @returns One classified row per input row, in the same order.
 */
export function classifyRows(
  rows: readonly MappedRow[],
  existing: readonly ExistingTransaction[],
): ClassifiedRow[] {
  const index = new ExistingIndex(existing)
  const seenIds = new Set<string>()
  return rows.map((row) =>
    row.externalId === null
      ? classifyByHeuristic(row, index)
      : classifyByExternalId(row, index, seenIds),
  )
}
