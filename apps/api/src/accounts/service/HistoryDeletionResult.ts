/** The outcome of deleting an account together with its history. */
export interface HistoryDeletionResult {
  /** Name of the account that was deleted. */
  readonly deletedAccount: string
  readonly deletedTransactions: number
  readonly deletedRecurringItems: number
}
