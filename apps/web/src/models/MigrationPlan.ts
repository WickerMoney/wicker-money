/** What moving an account's history into another account would do, as returned by the preview endpoint. */
export interface MigrationPlan {
  /** Transactions between the two accounts that disappear because they become internal. */
  readonly removedTransferTransactions: number
  /** Recurring transfers between the two accounts that are removed. */
  readonly removedTransferRecurringItems: number
  /** Transactions relocated into the target account. */
  readonly movedTransactions: number
  /** Recurring items relocated into the target account. */
  readonly movedRecurringItems: number
  /** Total rows the operation touches; sent back as the confirmation count. */
  readonly totalAffected: number
}
