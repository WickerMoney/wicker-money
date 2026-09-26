/** One transaction to write into the ledger during an import. */
export interface NewLedgerRow {
  /** Signed decimal string. */
  readonly amount: string
  /** Merchant text, already truncated to the column width. */
  readonly merchant: string
  /** ISO `YYYY-MM-DD` date. */
  readonly date: string
  /** Notes, or `null`. */
  readonly notes: string | null
  /** The source's own transaction id, or `null`. */
  readonly externalId: string | null
  /** The category a rule assigned, or `null` to leave it uncategorised. */
  readonly categoryId: string | null
}
