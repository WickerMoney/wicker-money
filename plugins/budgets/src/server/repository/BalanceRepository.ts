import type { HistoryEntry } from '../../shared/index.js'

/** Reads the history that carry-forward is replayed from. */
export interface BalanceRepository {
  /**
   * Loads each category's budget lines, with what was spent in each, for the
   * given month and the months before it, back to a bounded lookback.
   *
   * The carry-forward itself is never stored: the caller replays this history,
   * so a transaction imported late against an old month corrects every month
   * after it. The given month is included because the replay reads its opening balance
   * off its own entry.
   *
   * @param monthKey - The month whose opening balances are wanted, as `YYYY-MM`.
   * @param categoryIds - The categories to load; typically those with rollover on.
   * @returns Category id to its months in ascending order. A category with no
   *   history is absent, and an empty `categoryIds` returns an empty map
   *   without querying.
   */
  historyThrough(monthKey: string, categoryIds: readonly string[]): Promise<Map<string, HistoryEntry[]>>

  /**
   * The same replay history as {@link BalanceRepository.historyThrough}, for
   * account lines.
   *
   * Each month is measured with that month's own excluded categories, so
   * changing what an allowance excludes does not rewrite the months before.
   *
   * @param monthKey - The month whose opening balances are wanted, as `YYYY-MM`.
   * @param accountIds - The accounts to load; typically those with rollover on.
   * @returns Account id to its months in ascending order. An account with no
   *   history is absent, and an empty `accountIds` returns an empty map
   *   without querying.
   */
  accountHistoryThrough(monthKey: string, accountIds: readonly string[]): Promise<Map<string, HistoryEntry[]>>
}
