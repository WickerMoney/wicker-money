import type { AccountPick } from './AccountPick.js'
import type { CategoryPick } from './CategoryPick.js'
import type { MonthlyTotalRow } from './MonthlyTotalRow.js'

/** Read-only aggregations over the ledger. Every read is scoped to the current user by row-level security. */
export interface ReportRepository {
  /**
   * @param userId - The signed-in user.
   * @returns The user's IANA time zone, or `undefined` if the user does not exist.
   */
  findTimezone(userId: string): Promise<string | undefined>

  /** @returns How many accounts are not archived. */
  countActiveAccounts(): Promise<number>

  /** @returns Active accounts ordered by name. */
  listActiveAccounts(): Promise<AccountPick[]>

  /** @returns Enabled categories in display order. */
  listEnabledCategories(): Promise<CategoryPick[]>

  /**
   * Income and expense per month per category, transfers excluded.
   *
   * A split transaction contributes each split to its own category and only the
   * unsplit remainder to the parent's, so totals reconcile against the ledger.
   *
   * @param since - First day (`YYYY-MM-DD`) of the earliest month to include.
   * @returns One row per month, category and direction, oldest month first.
   */
  monthlyTotals(since: string): Promise<MonthlyTotalRow[]>
}
