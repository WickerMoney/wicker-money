import type { Transaction } from './Transaction.js'

/** One page of `GET /transactions`. */
export interface TransactionPage {
  /** The transactions on the page. */
  readonly items: Transaction[]
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  readonly nextCursor: string | null
  /** Transactions matching the filters across all pages. Present only when the request asked for it. */
  readonly total?: number
}
