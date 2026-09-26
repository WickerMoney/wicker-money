import type { TransactionCursor } from './TransactionCursor.js'

/** Filters, ordering and page window for listing transactions. */
export interface TransactionListQuery {
  /** Only transactions on this account. */
  readonly accountId?: string | undefined
  /** Only transactions filed under this category or any of its children. */
  readonly categoryId?: string | undefined
  /** When true, only transactions with no category. */
  readonly uncategorizedOnly?: boolean | undefined
  /** Earliest transaction date, inclusive, as `YYYY-MM-DD`. */
  readonly from?: string | undefined
  /** Latest transaction date, inclusive, as `YYYY-MM-DD`. */
  readonly to?: string | undefined
  /** Case-insensitive substring of the merchant, matched literally. */
  readonly search?: string | undefined
  /** Column to order by. */
  readonly sort: 'date' | 'amount' | 'merchant'
  /** Sort direction. */
  readonly direction: 'asc' | 'desc'
  /** Maximum rows in the page. */
  readonly limit: number
  /** Resume after the row this cursor names. Omit for the first page. */
  readonly cursor?: TransactionCursor | undefined
  /** When true, also count the rows matching the filters. Counting is costly, so it is opt-in. */
  readonly withTotal: boolean
}
