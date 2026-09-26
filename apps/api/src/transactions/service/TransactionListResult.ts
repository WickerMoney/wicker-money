import type { Transaction } from '../../db/models/index.js'
import type { TransactionCursor } from './TransactionCursor.js'

/** A page of transactions and how to continue after it. */
export interface TransactionListResult {
  /** The rows in the page. */
  readonly items: Transaction[]
  /** Where the next page starts, or `null` when this is the last page. */
  readonly nextCursor: TransactionCursor | null
  /** Rows matching the filters across all pages. Present only when it was requested. */
  readonly total?: number
}
