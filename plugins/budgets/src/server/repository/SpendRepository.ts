import type { AccountScope } from './AccountScope.js'
import type { CategoryRange } from './CategoryRange.js'

/** Net outflow per category, or per account, derived from the ledger on every read. */
export interface SpendRepository {
  /**
   * Net spend per category for one month.
   *
   * Transfer legs and categories of kind `transfer` or `income` are excluded;
   * a refund reduces the month rather than being ignored.
   *
   * @param monthKey - The month as `YYYY-MM`.
   * @returns Category id to net spend as a decimal string. Categories that net
   *   to zero are absent; one whose refunds exceed its spending is negative.
   */
  byCategory(monthKey: string): Promise<Map<string, string>>

  /**
   * Net spend per category per calendar month over a date range, applying the
   * same rules as {@link SpendRepository.byCategory}.
   *
   * @param start - Inclusive start date, `YYYY-MM-DD`.
   * @param end - Exclusive end date, `YYYY-MM-DD`.
   * @param categoryIds - Only these categories, when given. Omit for all of them.
   * @returns A map keyed `"<categoryId>:<YYYY-MM>"` to net spend as a decimal string.
   */
  byCategoryAndMonth(start: string, end: string, categoryIds?: readonly string[]): Promise<Map<string, string>>

  /**
   * Net spend for each of a set of category ranges, in one query.
   *
   * A range is one category over its own start and end dates, which need not
   * fall on month boundaries; a window that begins on the 15th is measured
   * from the 15th. The same rules as {@link SpendRepository.byCategory} apply.
   * The ledger is read once, over the earliest start to the latest end, however
   * many ranges there are.
   *
   * @param ranges - What to measure. An empty list returns an empty map without querying.
   * @returns Range key to net spend as a decimal string. A range that nets to
   *   zero, or is empty, is absent.
   */
  byCategoryRanges(ranges: readonly CategoryRange[]): Promise<Map<string, string>>

  /**
   * Net spend for each of a set of account scopes, in one query.
   *
   * A scope is one account over one date range with some categories left out.
   * It counts everything that left the account in that range by the same
   * rules as {@link SpendRepository.byCategory}: transfer legs and categories
   * of kind `transfer` or `income` are excluded, a split transaction counts
   * each part in its own category, and a refund reduces the total.
   *
   * It differs in one deliberate way. Spending with no category is spending
   * from the account, so it counts, where a category budget has nothing to
   * attach it to. An uncategorized deposit is not a refund of anything, though,
   * so only uncategorized outflow counts: otherwise the month's allowance
   * arriving as an unlabeled deposit would read as negative spending.
   *
   * @param scopes - What to measure. An empty list returns an empty map without querying.
   * @returns Scope key to net spend as a decimal string. A scope that nets to
   *   zero is absent.
   */
  byAccountScopes(scopes: readonly AccountScope[]): Promise<Map<string, string>>
}
