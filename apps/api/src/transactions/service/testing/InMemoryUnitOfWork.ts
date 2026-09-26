import type { CategoryRuleRepository } from '../../../categories/repository/CategoryRuleRepository.js'
import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { FakeLedger } from './FakeLedger.js'
import { InMemorySplitRepository } from './InMemorySplitRepository.js'
import { InMemoryTransactionRepository } from './InMemoryTransactionRepository.js'

/**
 * A {@link UnitOfWork} over an in-memory ledger.
 *
 * Like a database transaction it is atomic: when the callback throws, every
 * change it made is discarded. Only the transaction, split and rule-matching
 * repositories exist; touching any other one fails the test loudly.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  /** The state under test; assertions read it directly. */
  ledger: FakeLedger = { accounts: [], categories: [], transactions: [], splits: [], rules: [] }

  /** The transaction repository of the most recent unit of work, for lock assertions. */
  lastTransactions: InMemoryTransactionRepository | undefined

  /** @inheritdoc */
  async forUser<T>(userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.ledger)
    const transactions = new InMemoryTransactionRepository(this.ledger, userId)
    this.lastTransactions = transactions
    const repos = {
      transactions,
      splits: new InMemorySplitRepository(this.ledger, userId),
      categoryRules: {
        fetchForMatching: () => Promise.resolve(this.ledger.rules),
      } as Pick<CategoryRuleRepository, 'fetchForMatching'> as CategoryRuleRepository,
    } as Partial<Repositories> as Repositories
    try {
      return await work(repos)
    } catch (error) {
      this.ledger = snapshot
      throw error
    }
  }

  /** @inheritdoc */
  forSystem<T>(): Promise<T> {
    return Promise.reject(new Error('forSystem is not used by transaction rules.'))
  }
}
