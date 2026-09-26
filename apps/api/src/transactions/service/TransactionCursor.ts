/**
 * A resumable position in a sorted transaction listing: the last row a client
 * has seen. It records the sort it was issued for, because a position in one
 * order means nothing in another.
 */
export interface TransactionCursor {
  /** The column the listing was sorted on. */
  readonly sort: 'date' | 'amount' | 'merchant'
  /** The direction the listing was sorted in. */
  readonly direction: 'asc' | 'desc'
  /** The last row's value in the sort column: an ISO date, a decimal amount or a merchant. */
  readonly value: string
  /** The last row's id, which breaks ties between equal values. */
  readonly id: string
}
