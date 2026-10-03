/** A ledger transaction that could settle an occurrence, with what matching needs to judge it. */
export interface CandidateTransactionRow {
  readonly id: string
  readonly account_id: string
  /** Signed `numeric(19,4)` string. */
  readonly amount: string
  readonly transaction_date: string
  readonly merchant: string
  /** Links the two rows of a transfer; `null` otherwise. */
  readonly transfer_id: string | null
  /** The occurrence it already settles, or `null`. */
  readonly recurring_occurrence_id: string | null
}
