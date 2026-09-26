import type { ImportRepositories } from './ImportRepositories.js'

/**
 * The transaction boundary the import service works within.
 *
 * Each call opens one transaction as the given user, so row-level security
 * narrows every repository to that user's rows, and hands the callback the
 * repositories over it. The transaction commits when the callback resolves and
 * rolls back when it throws.
 */
export interface ImportUnitOfWork {
  /**
   * @param userId - The authenticated user's id.
   * @param work - Business logic; receives repositories bound to the transaction.
   * @returns Whatever `work` returns.
   */
  run<T>(userId: string, work: (repos: ImportRepositories) => Promise<T>): Promise<T>
}
