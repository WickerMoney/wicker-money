import type { ImportLockRepository } from './ImportLockRepository.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/** {@link ImportLockRepository} using a transaction-scoped PostgreSQL advisory lock. */
export class QueryImportLockRepository implements ImportLockRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async lockAccount(userId: string, accountId: string): Promise<void> {
    const key = `import-csv:${userId}:${accountId}`
    await this.q`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`
  }
}
