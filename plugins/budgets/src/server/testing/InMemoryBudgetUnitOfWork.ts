import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
import type { BudgetUnitOfWork } from '../repository/BudgetUnitOfWork.js'
import { InMemoryBalanceRepository } from './InMemoryBalanceRepository.js'
import { InMemoryBudgetLineRepository } from './InMemoryBudgetLineRepository.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'
import { InMemorySpendRepository } from './InMemorySpendRepository.js'

/**
 * A {@link BudgetUnitOfWork} over an {@link InMemoryBudgetStore}, for testing
 * the service without a database. It has no transactions: a callback that
 * throws leaves any earlier writes in place.
 */
export class InMemoryBudgetUnitOfWork implements BudgetUnitOfWork {
  /** @param store - The data every unit of work reads and writes. */
  constructor(private readonly store: InMemoryBudgetStore) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: BudgetRepositories) => Promise<T>): Promise<T> {
    return work({
      lines: new InMemoryBudgetLineRepository(this.store, userId),
      spend: new InMemorySpendRepository(this.store, userId),
      balances: new InMemoryBalanceRepository(this.store, userId),
      categories: { list: async () => [...this.store.categories] },
    })
  }
}
