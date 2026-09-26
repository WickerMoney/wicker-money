import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { FakeLedger } from './FakeLedger.js'
import { InMemoryAccountRepository } from './InMemoryAccountRepository.js'

/**
 * A {@link UnitOfWork} over an in-memory ledger.
 *
 * Like a database transaction it is atomic: if the callback throws, every
 * change it made is discarded. Only the account and usage repositories exist;
 * touching any other one fails the test loudly.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  /** The state under test; assertions read it directly. */
  ledger: FakeLedger = { accounts: [], transactions: [], recurringItems: [] }

  /** Number of units of work opened, to assert that validation short-circuits before any database access. */
  opened = 0

  /** @inheritdoc */
  async forUser<T>(userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    this.opened++
    const snapshot = structuredClone(this.ledger)
    const accounts = new InMemoryAccountRepository(this.ledger, userId)
    const repos = {
      accounts,
      usage: { summarize: async (_parent: string, _pattern: string, id: string) => accounts.summarizeUsage(id) },
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
    return Promise.reject(new Error('forSystem is not used by account rules.'))
  }
}
