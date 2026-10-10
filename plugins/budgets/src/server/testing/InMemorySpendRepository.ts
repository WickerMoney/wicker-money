import { addMoney, compareMoney, negateMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import type { AccountScope } from '../repository/AccountScope.js'
import type { CategoryRange } from '../repository/CategoryRange.js'
import type { SpendRepository } from '../repository/SpendRepository.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'

/** {@link SpendRepository} over an {@link InMemoryBudgetStore}, narrowed to one user. */
export class InMemorySpendRepository implements SpendRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose spend this repository can see.
   */
  constructor(
    private readonly store: InMemoryBudgetStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async byCategory(monthKey: string): Promise<Map<string, string>> {
    const out = new Map(
      this.store.spend
        .filter((s) => s.userId === this.userId && s.monthKey === monthKey)
        .map((s) => [s.categoryId, s.spent]),
    )
    for (const d of this.store.datedSpend) {
      if (d.userId !== this.userId || d.date.slice(0, 7) !== monthKey) continue
      out.set(d.categoryId, addMoney(out.get(d.categoryId) ?? ZERO_MONEY, d.spent))
    }
    return out
  }

  /** @inheritdoc */
  async byCategoryAndMonth(
    start: string,
    end: string,
    categoryIds?: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map(
      this.store.spend
        .filter((s) => s.userId === this.userId && `${s.monthKey}-01` >= start && `${s.monthKey}-01` < end)
        .map((s) => [`${s.categoryId}:${s.monthKey}`, s.spent]),
    )
    for (const d of this.store.datedSpend) {
      if (d.userId !== this.userId || d.date < start || d.date >= end) continue
      const key = `${d.categoryId}:${d.date.slice(0, 7)}`
      out.set(key, addMoney(out.get(key) ?? ZERO_MONEY, d.spent))
    }
    if (categoryIds === undefined) return out
    return new Map([...out].filter(([key]) => categoryIds.includes(key.slice(0, key.lastIndexOf(':')))))
  }

  /** @inheritdoc */
  async byCategoryRanges(ranges: readonly CategoryRange[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const range of ranges) {
      let total = ZERO_MONEY
      // Month-level seeds sit on the first of their month, as in byCategoryAndMonth.
      for (const s of this.store.spend) {
        const date = `${s.monthKey}-01`
        if (s.userId === this.userId && s.categoryId === range.categoryId && date >= range.start && date < range.end) {
          total = addMoney(total, s.spent)
        }
      }
      for (const d of this.store.datedSpend) {
        if (d.userId === this.userId && d.categoryId === range.categoryId && d.date >= range.start && d.date < range.end) {
          total = addMoney(total, d.spent)
        }
      }
      if (compareMoney(total, ZERO_MONEY) !== 0) out.set(range.key, total)
    }
    return out
  }

  /** @inheritdoc */
  async byAccountScopes(scopes: readonly AccountScope[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const scope of scopes) {
      let total = ZERO_MONEY
      for (const t of this.store.accountTransactions) {
        if (t.userId !== this.userId || t.accountId !== scope.accountId) continue
        if (t.date < scope.start || t.date >= scope.end) continue
        if (t.categoryId !== null && scope.excluded.includes(t.categoryId)) continue
        // The real query's rule: uncategorized money in is not a refund.
        if (t.categoryId === null && compareMoney(t.amount, ZERO_MONEY) >= 0) continue
        total = addMoney(total, t.amount)
      }
      if (compareMoney(total, ZERO_MONEY) !== 0) out.set(scope.key, negateMoney(total))
    }
    return out
  }
}
