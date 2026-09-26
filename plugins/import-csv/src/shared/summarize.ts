import type { ClassifiedRow } from './ClassifiedRow.js'
import type { ClassifySummary } from './ClassifySummary.js'

/**
 * Counts classified rows by verdict.
 *
 * @param rows - The output of `classifyRows`.
 * @returns The total and the number of new, duplicate and needs-review rows.
 */
export function summarize(rows: readonly ClassifiedRow[]): ClassifySummary {
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    needsReview: rows.filter((r) => r.status === 'needs-review').length,
  }
}
