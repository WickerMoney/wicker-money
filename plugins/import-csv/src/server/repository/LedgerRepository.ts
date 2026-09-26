import type { ExistingTransaction } from '../../shared/index.js'
import type { NewLedgerRow } from './NewLedgerRow.js'

/** The ledger operations an import needs: read for duplicate detection, bulk insert, and revert. */
export interface LedgerRepository {
  /**
   * Reads an account's transactions in a date range.
   *
   * @param accountId - The account.
   * @param from - Inclusive ISO start date.
   * @param to - Inclusive ISO end date.
   * @returns The transactions, reduced to what duplicate detection compares.
   */
  findInWindow(accountId: string, from: string, to: string): Promise<ExistingTransaction[]>

  /**
   * Inserts rows in bulk, skipping any whose `(account, external id)` already exists.
   *
   * @param accountId - The account to write into.
   * @param rows - The rows to insert.
   * @returns The ids of the rows actually written; a row lost to a concurrent
   *   duplicate contributes nothing.
   */
  insertImported(accountId: string, rows: readonly NewLedgerRow[]): Promise<string[]>

  /**
   * Deletes the transactions of a batch that nobody has touched since import.
   *
   * A transaction counts as touched when it was edited, split, turned into a
   * transfer, or given a category by anything other than the import's own rules.
   *
   * @param batchId - The batch.
   * @returns The number of transactions deleted.
   */
  deleteUntouchedInBatch(batchId: string): Promise<number>

  /**
   * Counts a batch's transactions that still exist.
   *
   * @param batchId - The batch.
   * @returns The number of linked transactions still in the ledger.
   */
  countInBatch(batchId: string): Promise<number>
}
