/** What moving one account's history into another would do, broken down by kind of row. */
export interface MigrationPlan {
  /** Transactions transferring between the two accounts, which are deleted because they would become self-transfers. */
  readonly removedTransferTransactions: number
  /** Recurring items transferring between the two accounts, which are deleted for the same reason. */
  readonly removedTransferRecurringItems: number
  /** Transactions that are re-pointed at the target account. */
  readonly movedTransactions: number
  /** Recurring items that are re-pointed at the target account. */
  readonly movedRecurringItems: number
  /** The sum of the four counts above; this is the number a caller confirms. */
  readonly totalAffected: number
}
