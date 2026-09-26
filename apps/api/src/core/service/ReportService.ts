import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { AccountPick } from '../repository/AccountPick.js'
import type { CategoryPick } from '../repository/CategoryPick.js'
import { firstOfMonthBefore } from './firstOfMonthBefore.js'
import type { MonthlySummary } from './MonthlySummary.js'
import { todayIn } from './todayIn.js'

const MIN_MONTHS = 1
const MAX_MONTHS = 36
const DEFAULT_MONTHS = 12

/** Read-side aggregations for dashboards and plugins. */
export class ReportService {
  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param now - Clock, replaceable in tests.
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * @param userId - The signed-in user.
   * @returns How many of the user's accounts are not archived.
   */
  countActiveAccounts(userId: string): Promise<number> {
    return this.uow.forUser(userId, (r) => r.reports.countActiveAccounts())
  }

  /**
   * @param userId - The signed-in user.
   * @returns Active accounts by name, without balances.
   */
  listAccounts(userId: string): Promise<AccountPick[]> {
    return this.uow.forUser(userId, (r) => r.reports.listActiveAccounts())
  }

  /**
   * @param userId - The signed-in user.
   * @returns Enabled categories in display order. Disabled ones stay attached to
   * existing transactions but are no longer offered.
   */
  listCategoryPicker(userId: string): Promise<CategoryPick[]> {
    return this.uow.forUser(userId, (r) => r.reports.listEnabledCategories())
  }

  /**
   * Income and expense per month per category, transfers excluded.
   *
   * "This month" is decided in the user's own time zone, so someone just past
   * midnight local time on the first of a month does not see last month's
   * window. A split transaction is attributed to its split categories.
   *
   * @param userId - The signed-in user.
   * @param requestedMonths - How many months back to cover; clamped to 1-36 and truncated to a whole number; a non-number means 12.
   * @returns The months covered and the totals.
   */
  monthlySummary(userId: string, requestedMonths: number): Promise<MonthlySummary> {
    const whole = Number.isFinite(requestedMonths) ? Math.trunc(requestedMonths) : DEFAULT_MONTHS
    const months = Math.min(Math.max(whole, MIN_MONTHS), MAX_MONTHS)
    return this.uow.forUser(userId, async ({ reports }) => {
      const timezone = (await reports.findTimezone(userId)) ?? 'UTC'
      const since = firstOfMonthBefore(todayIn(timezone, this.now()), months - 1)
      const rows = await reports.monthlyTotals(since)
      return {
        months,
        rows: rows.map((r) => ({
          month: r.month,
          categoryId: r.category_id,
          categoryName: r.category_name ?? 'Uncategorized',
          kind: r.kind,
          total: r.total,
        })),
      }
    })
  }
}
