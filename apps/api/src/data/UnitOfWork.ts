import type { TransactionOptions } from '../db/client.js'
import type { Repositories } from './Repositories.js'

/**
 * The transaction boundary services work within.
 *
 * Each call opens one database transaction, binds it to a user (so
 * row-level security applies), hands the callback a fresh set of repositories
 * over that transaction, and commits when the callback resolves or rolls back
 * when it throws. Nothing outside a unit of work touches the database.
 */
export interface UnitOfWork {
  /**
   * Runs `work` as a user. Every repository sees only that user's rows.
   *
   * @param userId - The authenticated user's id.
   * @param work - Business logic; receives repositories bound to the transaction.
   * @param options - Optional isolation level and access mode.
   * @returns Whatever `work` returns.
   */
  forUser<T>(userId: string, work: (repos: Repositories) => Promise<T>, options?: TransactionOptions): Promise<T>

  /**
   * Runs `work` with no user bound. Intended for the narrow set of
   * pre-authentication operations (login, refresh) that go through
   * purpose-built database functions.
   *
   * @param work - Business logic; receives repositories bound to the transaction.
   * @param options - Optional isolation level and access mode.
   * @returns Whatever `work` returns.
   */
  forSystem<T>(work: (repos: Repositories) => Promise<T>, options?: TransactionOptions): Promise<T>
}
