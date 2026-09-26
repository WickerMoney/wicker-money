/**
 * A row's place in a sorted listing: the value of the column being sorted on,
 * plus the row id that breaks ties between equal values.
 */
export interface TransactionPosition {
  /** The sort column's value, as text: an ISO date, a decimal amount or a merchant. */
  readonly value: string
  /** The id of the row. */
  readonly id: string
}
