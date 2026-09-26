/** A ledger transaction as returned by `GET /transactions`. */
export interface Transaction {
  /** The transaction id. */
  readonly id: string
  /** Merchant or description text. */
  readonly merchant: string
  /** Signed decimal string: negative for spending, positive for income. */
  readonly amount: string
  /** ISO date, `YYYY-MM-DD`. */
  readonly transaction_date: string
  /** The assigned category id, or `null` if uncategorized. */
  readonly category_id: string | null
  /** How the category was assigned, for example `manual` or `rule`. */
  readonly category_source: string | null
  /** Free-text notes, or `null`. */
  readonly notes: string | null
  /** Set on both legs of a transfer, and on nothing else. */
  readonly transfer_id: string | null
}
