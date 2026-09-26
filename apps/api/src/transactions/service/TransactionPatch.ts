/** Fields of a transaction that may be edited; absent fields are left alone. */
export interface TransactionPatch {
  readonly amount?: string | undefined
  readonly merchant?: string | undefined
  /** `YYYY-MM-DD`. */
  readonly transactionDate?: string | undefined
  /** `null` clears the category. */
  readonly categoryId?: string | null | undefined
  readonly notes?: string | null | undefined
  /** Refused when present: whether a row is a transfer cannot be edited. */
  readonly transferAccountId?: string | null | undefined
}
