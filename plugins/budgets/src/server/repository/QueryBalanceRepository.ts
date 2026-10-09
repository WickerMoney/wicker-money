import { ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { monthKeyOf, monthPeriod, shiftMonth, type HistoryEntry } from '../../shared/index.js'
import { CARRY_LOOKBACK_MONTHS } from '../constants.js'
import type { BalanceRepository } from './BalanceRepository.js'
import type { Query } from './Query.js'
import type { SpendRepository } from './SpendRepository.js'

/**
 * {@link BalanceRepository} over a user-bound query runner.
 *
 * All categories are handled in one query rather than one per category, since a
 * month with fifteen sinking funds would otherwise cost fifteen round trips
 * before the page renders.
 */
export class QueryBalanceRepository implements BalanceRepository {
  /**
   * @param q - A query runner already bound to the current user.
   * @param spend - Supplies what was spent in each historical month.
   */
  constructor(
    private readonly q: Query,
    private readonly spend: SpendRepository,
  ) {}

  /** @inheritdoc */
  async historyThrough(
    monthKey: string,
    categoryIds: readonly string[],
  ): Promise<Map<string, HistoryEntry[]>> {
    if (categoryIds.length === 0) return new Map()

    const from = monthPeriod(shiftMonth(monthKey, -CARRY_LOOKBACK_MONTHS)).start
    const { end } = monthPeriod(monthKey)

    const history = await this.q<{
      category_id: string
      period_start: string
      planned: string
      rollover: boolean
    }>`
      SELECT category_id, period_start::text, planned::text, rollover
      FROM plugin_budgets.budget_lines
      WHERE category_id = ANY(${categoryIds}::uuid[])
        AND period_start >= ${from}::date
        AND period_start <  ${end}::date
        -- Monthly lines only. A window has no month-by-month chain to replay;
        -- it reports its own balance (see shared/window.ts).
        AND period_start = date_trunc('month', period_start)::date
        AND period_end = (period_start + interval '1 month')::date
      ORDER BY category_id, period_start
    `

    // Spend for every month in range, in one pass, rather than a query per month.
    const spendByMonth = await this.spend.byCategoryAndMonth(from, end)

    const byCategory = new Map<string, HistoryEntry[]>()
    for (const row of history) {
      const key = monthKeyOf(row.period_start)
      const list = byCategory.get(row.category_id) ?? []
      list.push({
        monthKey: key,
        planned: row.planned,
        spent: spendByMonth.get(`${row.category_id}:${key}`) ?? ZERO_MONEY,
        rollover: row.rollover,
      })
      byCategory.set(row.category_id, list)
    }
    return byCategory
  }

  /** @inheritdoc */
  async accountHistoryThrough(
    monthKey: string,
    accountIds: readonly string[],
  ): Promise<Map<string, HistoryEntry[]>> {
    if (accountIds.length === 0) return new Map()

    const from = monthPeriod(shiftMonth(monthKey, -CARRY_LOOKBACK_MONTHS)).start
    const { end } = monthPeriod(monthKey)

    const lines = await this.q<{
      id: string
      account_id: string
      period_start: string
      planned: string
      rollover: boolean
      excluded_category_ids: string[]
    }>`
      SELECT id, account_id, period_start::text, planned::text, rollover, excluded_category_ids
      FROM plugin_budgets.account_lines
      WHERE account_id = ANY(${[...accountIds]}::uuid[])
        AND period_start >= ${from}::date
        AND period_start <  ${end}::date
      ORDER BY account_id, period_start
    `

    // Every month's spend in one pass, each against its own exclusions.
    const spent = await this.spend.byAccountScopes(
      lines.map((l) => ({
        key: l.id,
        accountId: l.account_id,
        start: l.period_start,
        end: monthPeriod(monthKeyOf(l.period_start)).end,
        excluded: l.excluded_category_ids,
      })),
    )

    const byAccount = new Map<string, HistoryEntry[]>()
    for (const line of lines) {
      const list = byAccount.get(line.account_id) ?? []
      list.push({
        monthKey: monthKeyOf(line.period_start),
        planned: line.planned,
        spent: spent.get(line.id) ?? ZERO_MONEY,
        rollover: line.rollover,
      })
      byAccount.set(line.account_id, list)
    }
    return byAccount
  }
}
