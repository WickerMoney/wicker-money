/** The outcome of reverting a batch. */
export interface RevertResult {
  /** Transactions deleted. */
  readonly reverted: number
  /** Transactions kept because they were edited, split, categorised by hand or turned into transfers since import. */
  readonly skipped: number
}
