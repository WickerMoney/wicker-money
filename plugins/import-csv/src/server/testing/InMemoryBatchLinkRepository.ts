import type { BatchLinkRepository } from '../repository/BatchLinkRepository.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'

/** {@link BatchLinkRepository} over an {@link InMemoryImportStore}. */
export class InMemoryBatchLinkRepository implements BatchLinkRepository {
  /** @param store - The shared data. */
  constructor(private readonly store: InMemoryImportStore) {}

  /** @inheritdoc */
  async linkMany(batchId: string, transactionIds: readonly string[]): Promise<void> {
    this.store.callLog.push('linkMany')
    this.store.links.set(batchId, [...(this.store.links.get(batchId) ?? []), ...transactionIds])
  }
}
