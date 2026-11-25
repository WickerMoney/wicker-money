/** The answer to a successful restore. */
export interface TransactionUndoRestored {
  /** Transactions put back: 1, or 2 for a transfer. */
  readonly restored: number
  /** Whether a restored transaction is linked to its recurring occurrence again. */
  readonly relinkedMatch: boolean
  /** Match dismissals put back. */
  readonly restoredDismissals: number
  /** Dismissals not put back because their recurring item has been deleted. */
  readonly skippedDismissals: number
}
