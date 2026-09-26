import type { CategorySource } from '../../../db/models/index.js'
import type { TransactionRepository } from '../../../transactions/repository/TransactionRepository.js'
import type { FakeCategoryState } from './FakeCategoryState.js'

/**
 * The slice of {@link TransactionRepository} that applying a rule uses:
 * `assignCategory`. Transfer legs are never updated. Every other method is
 * absent, so a service reaching for one fails the test loudly.
 */
export class InMemoryRuleTransactionRepository {
  /**
   * @param state - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly state: FakeCategoryState,
    private readonly userId: string,
  ) {}

  /** @returns This object typed as the full repository, for the registry. */
  asRepository(): TransactionRepository {
    return this as unknown as TransactionRepository
  }

  /**
   * @param ids - Transactions to update.
   * @param categoryId - Category to assign.
   * @param source - How the category was chosen.
   * @returns The number of rows updated.
   */
  assignCategory(ids: readonly string[], categoryId: string, source: CategorySource): Promise<number> {
    const wanted = new Set(ids)
    let updated = 0
    for (const t of this.state.transactions) {
      if (t.userId !== this.userId || t.transferId !== null || !wanted.has(t.id)) continue
      t.categoryId = categoryId
      t.categorySource = source
      updated += 1
    }
    return Promise.resolve(updated)
  }
}
