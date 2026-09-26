import type { CategorySource, Transaction } from '../../db/models/index.js'
import type { AccountName } from './AccountName.js'
import type { NewTransactionInput } from './NewTransactionInput.js'
import type { NewTransferLegInput } from './NewTransferLegInput.js'
import type { TransactionChanges } from './TransactionChanges.js'
import type { TransactionFilterCriteria } from './TransactionFilterCriteria.js'
import type { TransactionListCriteria } from './TransactionListCriteria.js'
import type { TransactionPage } from './TransactionPage.js'

/** Persistence operations for ledger transactions, including transfer legs. */
export interface TransactionRepository {
  /**
   * Lists one page of the transactions matching the criteria, in a total order:
   * the sort column, then the row id in the same direction. Resumes after
   * `criteria.after` when given, so a page costs the same however deep it is.
   *
   * @param criteria - Filters, sort, page size and the position to resume after.
   * @returns The page, and whether more rows follow it.
   */
  listPage(criteria: TransactionListCriteria): Promise<TransactionPage>

  /**
   * Counts the transactions matching the filters, however many pages they span.
   *
   * @param criteria - The filters.
   * @returns The number of matching rows.
   */
  countMatching(criteria: TransactionFilterCriteria): Promise<number>

  /**
   * @param id - Transaction id.
   * @returns The row, or undefined if it does not exist or is not visible to the user.
   */
  findById(id: string): Promise<Transaction | undefined>

  /**
   * Reads a row and locks it (`FOR UPDATE`) until the transaction ends, so a
   * concurrent edit of the same row waits and then sees this one's result.
   *
   * @param id - Transaction id.
   * @returns The latest committed row, or undefined if it does not exist or is not visible.
   */
  lockById(id: string): Promise<Transaction | undefined>

  /**
   * Locks every leg of a transfer in ascending id order. Always locking in the
   * same order means two requests touching the same pair queue instead of
   * deadlocking.
   *
   * @param transferId - The id shared by the legs.
   * @returns The legs, ordered by id. Empty if the transfer does not exist.
   */
  lockTransferLegs(transferId: string): Promise<Transaction[]>

  /**
   * @param input - The transaction to insert.
   * @returns The inserted row.
   * @throws {DuplicateKeyError} If the account already has a transaction with the same external id.
   */
  insert(input: NewTransactionInput): Promise<Transaction>

  /**
   * Inserts both legs of a transfer in a single statement.
   *
   * @param legs - The legs to insert.
   * @returns The inserted rows, in the order given.
   */
  insertTransferLegs(legs: readonly NewTransferLegInput[]): Promise<Transaction[]>

  /**
   * @param id - Transaction id.
   * @param changes - The columns to change; `updated_at` is always refreshed.
   * @returns The updated row, or undefined if it does not exist.
   */
  update(id: string, changes: TransactionChanges): Promise<Transaction | undefined>

  /**
   * Sets or clears the flag that marks a transaction as having splits.
   *
   * @param id - Transaction id.
   * @param isSplit - The new flag value.
   */
  setSplitFlag(id: string, isSplit: boolean): Promise<void>

  /**
   * @param id - Transaction id.
   * @returns Whether a row was deleted.
   */
  delete(id: string): Promise<boolean>

  /**
   * Deletes every leg of a transfer.
   *
   * @param transferId - The id shared by the legs.
   * @returns The number of rows deleted.
   */
  deleteTransferLegs(transferId: string): Promise<number>

  /**
   * Picks out which of a set of ids are transfer legs.
   *
   * @param ids - Candidate transaction ids.
   * @returns The subset that are transfer legs.
   */
  findTransferLegIds(ids: readonly string[]): Promise<string[]>

  /**
   * Sets the category on a set of transactions and records how it was chosen.
   * Transfer legs are never touched: money moving between accounts is neither
   * spending nor income, so it carries no category. Ids are passed as a single
   * array parameter, so the size of `ids` is not limited by the driver's
   * bind-parameter cap.
   *
   * @param ids - Transactions to update.
   * @param categoryId - The category to assign.
   * @param source - How the category was chosen (`rule`, `manual`, ...).
   * @returns The number of rows updated.
   */
  assignCategory(ids: readonly string[], categoryId: string, source: CategorySource): Promise<number>

  /**
   * Removes the category, and with it the source, from a set of transactions.
   * Transfer legs are never touched.
   *
   * @param ids - Transactions to update.
   * @returns The number of rows updated.
   */
  clearCategory(ids: readonly string[]): Promise<number>

  /**
   * Looks up accounts visible to the user.
   *
   * @param ids - Account ids.
   * @returns Id and name of each that exists and belongs to the user.
   */
  findAccounts(ids: readonly string[]): Promise<AccountName[]>

  /**
   * Looks up categories visible to the user.
   *
   * @param ids - Category ids.
   * @returns The subset that exists and belongs to the user.
   */
  findCategoryIds(ids: readonly string[]): Promise<Set<string>>
}
