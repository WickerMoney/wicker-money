import type { AccountRepository } from './AccountRepository.js'
import type { Query } from './Query.js'

/** {@link AccountRepository} over the plugin's query runner. */
export class QueryAccountRepository implements AccountRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async isVisible(accountId: string): Promise<boolean> {
    const rows = await this.q<{ id: string }>`SELECT id FROM core.accounts WHERE id = ${accountId}`
    return rows.length > 0
  }
}
