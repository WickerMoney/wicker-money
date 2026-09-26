/**
 * A transaction row's unsaved edits: merchant, amount, date and notes.
 *
 * Category is deliberately absent. The category cell saves on change by itself,
 * and a transfer leg never offers one; a second edit path would be a second way
 * to do the same thing that could disagree with the first.
 */
export interface TransactionEdit {
  /** Id of the transaction being edited. */
  readonly id: string
  /** Unsaved merchant text. */
  merchant: string
  /** Unsaved signed amount, as typed. */
  amount: string
  /** Unsaved date, `YYYY-MM-DD`. */
  transactionDate: string
  /** Unsaved notes text. */
  notes: string
  /** `true` when the row is one leg of a transfer, whose other leg is kept in sync. */
  readonly isTransfer: boolean
}
