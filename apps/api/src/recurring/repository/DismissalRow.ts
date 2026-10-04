/** A dismissed suggestion: this transaction is not this occurrence. */
export interface DismissalRow {
  readonly transaction_id: string
  readonly recurring_item_id: string
  /** The occurrence's nominal date, `YYYY-MM-DD`. */
  readonly nominal_date: string
}
