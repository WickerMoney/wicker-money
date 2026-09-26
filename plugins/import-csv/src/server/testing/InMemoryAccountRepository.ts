import type { AccountRepository } from '../repository/AccountRepository.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'

/** {@link AccountRepository} over an {@link InMemoryImportStore}, narrowed to one user. */
export class InMemoryAccountRepository implements AccountRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose accounts are visible.
   */
  constructor(
    private readonly store: InMemoryImportStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async isVisible(accountId: string): Promise<boolean> {
    return this.store.accounts.get(accountId) === this.userId
  }
}
