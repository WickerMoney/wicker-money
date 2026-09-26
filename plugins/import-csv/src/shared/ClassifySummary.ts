/** Row counts by verdict. */
export interface ClassifySummary {
  /** Number of rows classified. */
  readonly total: number
  /** Rows with status `new`. */
  readonly new: number
  /** Rows with status `duplicate`. */
  readonly duplicate: number
  /** Rows with status `needs-review`. */
  readonly needsReview: number
}
