import type { AnalyzedRow } from './AnalyzedRow.js'

/** One page of the rows duplicate detection could not decide, in file order. */
export interface FlaggedRows {
  /** Every flagged row in the file, not just this page. Equals `summary.needsReview`. */
  readonly total: number
  /** How many flagged rows were skipped before this page. */
  readonly offset: number
  /** The page: rows whose status is `needs-review`. */
  readonly rows: readonly AnalyzedRow[]
}
