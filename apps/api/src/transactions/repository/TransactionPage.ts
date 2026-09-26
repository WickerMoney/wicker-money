import type { Transaction } from '../../db/models/index.js'

/** One page of a transaction listing. */
export interface TransactionPage {
  /** The rows in the page, at most the requested limit. */
  readonly items: Transaction[]
  /** Whether at least one more row follows the last item. */
  readonly hasMore: boolean
}
