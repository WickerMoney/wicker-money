/** Links an import batch to the transactions it created. */
export interface BatchLinkRepository {
  /**
   * Records that a batch created the given transactions.
   *
   * @param batchId - The batch.
   * @param transactionIds - The ids of the transactions it wrote.
   */
  linkMany(batchId: string, transactionIds: readonly string[]): Promise<void>
}
