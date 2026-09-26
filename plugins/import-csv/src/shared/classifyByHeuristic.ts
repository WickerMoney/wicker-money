import type { ClassifiedRow } from './ClassifiedRow.js'
import type { ExistingIndex } from './ExistingIndex.js'
import type { MappedRow } from './mapping.js'
import { normalizeMoney } from './normalizeMoney.js'

/**
 * Classifies a row that has no source id, by amount, merchant and date.
 *
 * A match is a guess, so it is `needs-review` rather than `duplicate`: two
 * identical coffees on one day are indistinguishable from one coffee imported
 * twice.
 *
 * @param row - A mapped row without an external id.
 * @param existing - Index of the transactions already in the account.
 * @returns `needs-review` with the matched transaction, or `new`.
 */
export function classifyByHeuristic(row: MappedRow, existing: ExistingIndex): ClassifiedRow {
  const candidate = existing.findHeuristicMatch(row.amount, row.date, row.merchant)
  if (candidate === undefined) return { row, status: 'new', matched: null, reason: null }
  return {
    row,
    status: 'needs-review',
    matched: candidate,
    reason: `looks like ${candidate.merchant} on ${candidate.date} for ${normalizeMoney(candidate.amount)}`,
  }
}
