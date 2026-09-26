import type { TransactionSplit } from '../../db/models/index.js'
import type { NewSplitInput } from './NewSplitInput.js'

/** Persistence operations for the parts a transaction is split into. */
export interface SplitRepository {
  /**
   * @param transactionId - The parent transaction.
   * @returns Its split rows (empty when it has none).
   */
  listForTransaction(transactionId: string): Promise<TransactionSplit[]>

  /**
   * Deletes a transaction's existing splits and inserts the given set.
   *
   * @param transactionId - The parent transaction.
   * @param splits - The new parts; at least one.
   * @returns The inserted rows, in the order given.
   */
  replaceForTransaction(transactionId: string, splits: readonly NewSplitInput[]): Promise<TransactionSplit[]>

  /**
   * @param transactionId - The parent transaction.
   * @returns The number of split rows deleted.
   */
  deleteForTransaction(transactionId: string): Promise<number>
}
