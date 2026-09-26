import type { ReferenceUsage } from '../../../db/usage.js'
import type { UsageRepository } from '../../../db/repository/UsageRepository.js'
import type { FakeCategoryState } from './FakeCategoryState.js'

/**
 * A {@link UsageRepository} for categories, computed from the in-memory state:
 * transactions, rules and any registered external references.
 */
export class InMemoryUsageRepository implements UsageRepository {
  /**
   * @param state - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly state: FakeCategoryState,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  summarize(_parentTable: string, _columnPattern: string, id: string): Promise<ReferenceUsage> {
    const counts = new Map<string, number>()
    const bump = (table: string): void => void counts.set(table, (counts.get(table) ?? 0) + 1)
    for (const t of this.state.transactions) if (t.userId === this.userId && t.categoryId === id) bump('core.transactions')
    for (const r of this.state.rules) if (r.user_id === this.userId && r.category_id === id) bump('core.category_rules')
    for (const e of this.state.externalReferences) if (e.userId === this.userId && e.categoryId === id) bump(e.table)
    const by = [...counts].map(([table, count]) => ({ table, count }))
    return Promise.resolve({ total: by.reduce((sum, b) => sum + b.count, 0), by, unreadable: [] })
  }
}
