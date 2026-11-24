/** What one restore put back. */
export interface UndoRestoreCounts {
  /** Transactions inserted: 1, or 2 for a transfer. */
  readonly restored: number
  /** Whether at least one restored transaction was linked to a recurring occurrence again. */
  readonly relinkedMatch: boolean
  /** Match dismissals inserted again. */
  readonly restoredDismissals: number
  /** Dismissals not restored because their recurring item is gone. */
  readonly skippedDismissals: number
}
