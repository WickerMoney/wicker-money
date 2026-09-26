import type { ImportRepositories } from '../repository/ImportRepositories.js'
import type { ImportUnitOfWork } from '../repository/ImportUnitOfWork.js'
import { InMemoryAccountRepository } from './InMemoryAccountRepository.js'
import { InMemoryBatchLinkRepository } from './InMemoryBatchLinkRepository.js'
import { InMemoryBatchRepository } from './InMemoryBatchRepository.js'
import { InMemoryImportLockRepository } from './InMemoryImportLockRepository.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'
import { InMemoryLedgerRepository } from './InMemoryLedgerRepository.js'
import { InMemoryMappingRepository } from './InMemoryMappingRepository.js'

/**
 * An {@link ImportUnitOfWork} over an {@link InMemoryImportStore}, for testing
 * the service without a database. It has no transactions: a callback that
 * throws leaves any earlier writes in place.
 */
export class InMemoryImportUnitOfWork implements ImportUnitOfWork {
  /** @param store - The data every unit of work reads and writes. */
  constructor(private readonly store: InMemoryImportStore) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: ImportRepositories) => Promise<T>): Promise<T> {
    return work({
      accounts: new InMemoryAccountRepository(this.store, userId),
      locks: new InMemoryImportLockRepository(this.store),
      mappings: new InMemoryMappingRepository(this.store, userId),
      batches: new InMemoryBatchRepository(this.store, userId),
      batchLinks: new InMemoryBatchLinkRepository(this.store),
      ledger: new InMemoryLedgerRepository(this.store, userId),
      categoryRules: { loadForMatching: async () => this.store.rules },
    })
  }
}
