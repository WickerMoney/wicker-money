import type { SortDirection } from './SortDirection.js'
import type { SortField } from './SortField.js'

/** Everything the transaction list is currently narrowed and ordered by. */
export interface TransactionFilters {
  /** The merchant search text that has been submitted, not the text being typed. */
  readonly search: string
  /** Earliest date to include, `YYYY-MM-DD`, or an empty string for no limit. */
  readonly from: string
  /** Latest date to include, `YYYY-MM-DD`, or an empty string for no limit. */
  readonly to: string
  /** Restrict to one account id, or an empty string for all accounts. */
  readonly accountId: string
  /** Restrict to one category id, or an empty string for all categories. */
  readonly categoryId: string
  /** The field the list is ordered by. */
  readonly sort: SortField
  /** Ascending or descending order. */
  readonly direction: SortDirection
  /** When `true`, only transactions with no category are listed. */
  readonly onlyUncategorized: boolean
}
