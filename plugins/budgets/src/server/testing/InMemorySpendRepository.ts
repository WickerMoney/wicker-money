import { addMoney, compareMoney, negateMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import type { AccountScope } from '../repository/AccountScope.js'
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
    return new Map(
      this.store.spend
        .filter((s) => s.userId === this.userId && s.monthKey === monthKey)
        .map((s) => [s.categoryId, s.spent]),
    )
  }

  /** @inheritdoc */
  async byCategoryAndMonth(start: string, end: string): Promise<Map<string, string>> {
    return new Map(
      this.store.spend
        .filter((s) => s.userId === this.userId && `${s.monthKey}-01` >= start && `${s.monthKey}-01` < end)
        .map((s) => [`${s.categoryId}:${s.monthKey}`, s.spent]),
    )
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
