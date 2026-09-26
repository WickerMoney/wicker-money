/** A transaction already in the account, reduced to the fields duplicate detection compares. */
export interface ExistingTransaction {
  /** The stored transaction's id. */
  readonly id: string
  /** ISO `YYYY-MM-DD` date. */
  readonly date: string
  /** The stored merchant text. */
  readonly merchant: string
  /** Signed decimal string, possibly with the database's trailing zeros. */
  readonly amount: string
  /** The source's own id for the transaction, or `null` if it was not imported with one. */
  readonly externalId: string | null
}
