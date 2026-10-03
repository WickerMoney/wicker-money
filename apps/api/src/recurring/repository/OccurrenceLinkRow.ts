/** A transaction that settles a recurring occurrence. */
export interface OccurrenceLinkRow {
  readonly recurring_item_id: string
  /** The occurrence's nominal date, `YYYY-MM-DD`. */
  readonly nominal_date: string
  readonly transaction_id: string
  readonly account_id: string
  /** Signed `numeric(19,4)` string: what actually posted. */
  readonly amount: string
  readonly transaction_date: string
  readonly merchant: string
}
