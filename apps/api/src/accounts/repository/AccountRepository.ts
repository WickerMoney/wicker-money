import type { AccountBasic } from './AccountBasic.js'
import type { AccountChanges } from './AccountChanges.js'
import type { AccountLabel } from './AccountLabel.js'
import type { AccountWithBalance } from './AccountWithBalance.js'
import type { HistoryDeletion } from './HistoryDeletion.js'
import type { MigrationAccount } from './MigrationAccount.js'
import type { MigrationCounts } from './MigrationCounts.js'
import type { NewAccountInput } from './NewAccountInput.js'

/**
 * Persistence operations for the Account aggregate. All reads and writes are
 * scoped to the current user by row-level security, so an id belonging to
 * someone else behaves exactly like an id that does not exist.
 *
 * Balances are always derived from the ledger at read time, never stored.
 */
export interface AccountRepository {
  /**
   * @param includeArchived - Whether archived accounts are included.
   * @returns Accounts with derived balances, ordered by name.
   */
  listWithBalances(includeArchived: boolean): Promise<AccountWithBalance[]>

  /**
   * Like {@link listWithBalances}, but without the balance: no read of the
   * transactions table, so it stays cheap however long the ledger is.
   *
   * @param includeArchived - Whether archived accounts are included.
   * @returns Accounts ordered by name.
   */
  listBasic(includeArchived: boolean): Promise<AccountBasic[]>

  /**
   * @param id - Account id.
   * @returns The account with its derived balance (archived or not), or `undefined` if it does not exist.
   */
  findWithBalance(id: string): Promise<AccountWithBalance | undefined>

  /**
   * @param id - Account id.
   * @returns The account's id and name, or `undefined` if it does not exist.
   */
  findLabel(id: string): Promise<AccountLabel | undefined>

  /**
   * @param ids - Account ids to look up.
   * @returns The id, name and currency of each of those accounts that exists; missing ids are simply absent.
   */
  findMigrationAccounts(ids: readonly string[]): Promise<MigrationAccount[]>

  /**
   * Inserts an account.
   *
   * @param input - The new account.
   * @returns The inserted account with its derived balance.
   */
  insert(input: NewAccountInput): Promise<AccountWithBalance>

  /**
   * Applies a partial update and stamps `updated_at`.
   *
   * @param id - Account id.
   * @param changes - Fields to change.
   * @returns The updated account, or `undefined` if it does not exist.
   */
  update(id: string, changes: AccountChanges): Promise<AccountWithBalance | undefined>

  /**
   * Marks an account archived.
   *
   * @param id - Account id.
   * @returns The archived account, or `undefined` if it does not exist or is already archived.
   */
  archive(id: string): Promise<AccountWithBalance | undefined>

  /**
   * Replaces an account's opening balance and stamps `updated_at`.
   *
   * @param id - Account id.
   * @param initialBalance - New opening balance as a decimal string.
   * @returns The account with its recomputed balance, or `undefined` if it does not exist.
   */
  setInitialBalance(id: string, initialBalance: string): Promise<AccountWithBalance | undefined>

  /**
   * Deletes an account row. Fails at the database if anything still references it.
   *
   * @param id - Account id.
   * @returns Whether a row was deleted.
   */
  delete(id: string): Promise<boolean>

  /**
   * Counts what merging one account's history into another would touch.
   *
   * @param fromId - The account whose history would be moved.
   * @param toId - The account that would receive it.
   * @returns Counts of transfer rows between the two accounts and of all other rows referring to `fromId`.
   */
  countMigrationRows(fromId: string, toId: string): Promise<MigrationCounts>

  /**
   * Moves all history from one account to another.
   *
   * Transfers between the two accounts are deleted first, since re-pointing
   * them would make each an account transferring to itself, which the ledger
   * forbids. Everything else that refers to `fromId`, as account or as
   * transfer counterparty, is re-pointed at `toId`. The source account itself
   * is left in place.
   *
   * @param fromId - The account whose history is moved.
   * @param toId - The account that receives it.
   * @throws {DuplicateKeyError} When both accounts hold a transaction with the same external id.
   */
  moveHistory(fromId: string, toId: string): Promise<void>

  /**
   * Deletes every transaction and recurring item that touches an account, as
   * account or as transfer counterparty.
   *
   * @param id - Account id.
   * @returns How many rows of each kind were deleted.
   */
  deleteHistory(id: string): Promise<HistoryDeletion>
}
