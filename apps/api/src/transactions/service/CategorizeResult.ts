/** The outcome of a bulk categorization. */
export interface CategorizeResult {
  /** Rows actually changed. Rows the user cannot see are not counted. */
  readonly updated: number
  /** Ids in the request. */
  readonly requested: number
  /** Requested ids that are transfer legs and were therefore left alone. */
  readonly skippedTransfers: number
}
