/** Net outflow per category, derived from the ledger on every read. */
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
   * @returns A map keyed `"<categoryId>:<YYYY-MM>"` to net spend as a decimal string.
   */
  byCategoryAndMonth(start: string, end: string): Promise<Map<string, string>>
}
