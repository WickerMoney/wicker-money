import type { AccountRepository } from './AccountRepository.js'
import type { AccountRow } from './AccountRow.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/** {@link AccountRepository} over a user-bound query runner. */
export class QueryAccountRepository implements AccountRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  list(): Promise<AccountRow[]> {
    return this.q<AccountRow>`SELECT id, name, account_type::text AS account_type FROM core.accounts ORDER BY name`
  }
}
