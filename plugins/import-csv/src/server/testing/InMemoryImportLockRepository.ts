import type { ImportLockRepository } from '../repository/ImportLockRepository.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'

/** {@link ImportLockRepository} that records each lock request instead of blocking. */
export class InMemoryImportLockRepository implements ImportLockRepository {
  /** @param store - The shared data. */
  constructor(private readonly store: InMemoryImportStore) {}

  /** @inheritdoc */
  async lockAccount(userId: string, accountId: string): Promise<void> {
    this.store.callLog.push('lock')
    this.store.lockLog.push(`${userId}:${accountId}`)
  }
}
