/** Row counts a history migration between two accounts would touch, by kind of row. */
export interface MigrationCounts {
  /** Transactions transferring between the two accounts. */
  readonly transferTransactions: number
  /** Recurring items transferring between the two accounts. */
  readonly transferRecurringItems: number
  /** Transactions referring to the source account that are not transfers to or from the target. */
  readonly otherTransactions: number
  /** Recurring items referring to the source account that are not transfers to or from the target. */
  readonly otherRecurringItems: number
}
