import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { FakeCategoryState } from './FakeCategoryState.js'
import { emptyCategoryState } from './emptyCategoryState.js'
import { InMemoryCategoryRepository } from './InMemoryCategoryRepository.js'
import { InMemoryCategoryRuleRepository } from './InMemoryCategoryRuleRepository.js'
import { InMemoryRuleTransactionRepository } from './InMemoryRuleTransactionRepository.js'
import { InMemoryUsageRepository } from './InMemoryUsageRepository.js'

/**
 * A {@link UnitOfWork} over in-memory category state.
 *
 * Like a database transaction it is atomic: when the callback throws, every
 * change it made is discarded. Only the category, rule, usage and
 * transaction-assignment repositories exist; touching any other one fails the
 * test loudly.
 */
export class InMemoryCategoryUnitOfWork implements UnitOfWork {
  /** The state under test; assertions read and seed it directly. */
  state: FakeCategoryState = emptyCategoryState()

  /** @inheritdoc */
  async forUser<T>(userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state)
    const repos = {
      categories: new InMemoryCategoryRepository(this.state, userId),
      categoryRules: new InMemoryCategoryRuleRepository(this.state, userId),
      usage: new InMemoryUsageRepository(this.state, userId),
      transactions: new InMemoryRuleTransactionRepository(this.state, userId).asRepository(),
    } as Partial<Repositories> as Repositories
    try {
      return await work(repos)
    } catch (error) {
      this.state = snapshot
      throw error
    }
  }

  /** @inheritdoc */
  forSystem<T>(): Promise<T> {
    return Promise.reject(new Error('forSystem is not used by category services.'))
  }
}
