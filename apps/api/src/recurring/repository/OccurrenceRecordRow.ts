/** What was recorded about one occurrence, as the repository returns it. */
export interface OccurrenceRecordRow {
  readonly id: string
  readonly recurring_item_id: string
  /** The schedule's date for it, `YYYY-MM-DD`. */
  readonly nominal_date: string
  readonly skipped: boolean
  /** When it is expected instead, or `null` when on schedule. */
  readonly expected_date: string | null
  /** Per-account amounts for this occurrence only, ordered by account. */
  readonly legs: readonly { readonly account_id: string; readonly amount: string }[]
}
