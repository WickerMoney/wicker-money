import type { TransactionFilterCriteria } from './TransactionFilterCriteria.js'
import type { TransactionPosition } from './TransactionPosition.js'

/** Filters, ordering and page window for listing a user's transactions. */
export interface TransactionListCriteria extends TransactionFilterCriteria {
  /** Column to order by. */
  readonly sort: 'date' | 'amount' | 'merchant'
  /** Sort direction. The row id is ordered the same way, so the order is total. */
  readonly direction: 'asc' | 'desc'
  /** Maximum rows in the page. */
  readonly limit: number
  /** When set, only rows strictly after this position in the sort order are listed. */
  readonly after?: TransactionPosition
}
