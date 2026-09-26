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
}
