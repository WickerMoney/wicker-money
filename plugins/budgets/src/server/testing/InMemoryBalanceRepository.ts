import { isCalendarMonth, monthKeyOf, shiftMonth, type HistoryEntry } from '../../shared/index.js'
import { CARRY_LOOKBACK_MONTHS } from '../constants.js'
import type { BalanceRepository } from '../repository/BalanceRepository.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'
import { InMemorySpendRepository } from './InMemorySpendRepository.js'

/** {@link BalanceRepository} over an {@link InMemoryBudgetStore}, narrowed to one user. */
export class InMemoryBalanceRepository implements BalanceRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose history this repository can see.
   */
  constructor(
    private readonly store: InMemoryBudgetStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async historyThrough(
    monthKey: string,
    categoryIds: readonly string[],
  ): Promise<Map<string, HistoryEntry[]>> {
    const out = new Map<string, HistoryEntry[]>()
    const earliest = shiftMonth(monthKey, -CARRY_LOOKBACK_MONTHS)
    const earlier = this.store.lines
      .filter(
        (l) =>
          l.userId === this.userId &&
          isCalendarMonth(l.period_start, l.period_end) &&
          categoryIds.includes(l.category_id) &&
          monthKeyOf(l.period_start) >= earliest &&
          monthKeyOf(l.period_start) <= monthKey,
      )
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
    for (const l of earlier) {
      const key = monthKeyOf(l.period_start)
      const spent =
        this.store.spend.find(
          (s) => s.userId === this.userId && s.categoryId === l.category_id && s.monthKey === key,
        )?.spent ?? '0.0000'
      const list = out.get(l.category_id) ?? []
      list.push({ monthKey: key, planned: l.planned, spent, rollover: l.rollover })
      out.set(l.category_id, list)
    }
    return out
  }

  /** @inheritdoc */
  async accountHistoryThrough(
    monthKey: string,
    accountIds: readonly string[],
  ): Promise<Map<string, HistoryEntry[]>> {
    const out = new Map<string, HistoryEntry[]>()
    const earliest = shiftMonth(monthKey, -CARRY_LOOKBACK_MONTHS)
    const lines = this.store.accountLines
      .filter(
        (l) =>
          l.userId === this.userId &&
          accountIds.includes(l.account_id) &&
          monthKeyOf(l.period_start) >= earliest &&
          monthKeyOf(l.period_start) <= monthKey,
      )
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
    const spend = new InMemorySpendRepository(this.store, this.userId)
    for (const l of lines) {
      const spent = await spend.byAccountScopes([
        { key: l.id, accountId: l.account_id, start: l.period_start, end: l.period_end, excluded: l.excluded_category_ids },
      ])
      const list = out.get(l.account_id) ?? []
      list.push({
        monthKey: monthKeyOf(l.period_start), planned: l.planned, spent: spent.get(l.id) ?? '0.0000', rollover: l.rollover,
      })
      out.set(l.account_id, list)
    }
    return out
  }
}
