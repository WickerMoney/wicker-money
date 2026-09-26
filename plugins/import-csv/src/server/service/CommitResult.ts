/** The outcome of committing an import. */
export interface CommitResult {
  /** The id of the batch that was created. */
  readonly batchId: string
  /** Transactions written. */
  readonly imported: number
  /** Rows classified as duplicates and not written. */
  readonly skipped: number
  /** Rows flagged as possible duplicates. */
  readonly flagged: number
  /** Rows that could not be mapped. */
  readonly failed: number
  /** Present and `true` when the request repeated an earlier commit and nothing was written. */
  readonly replayed?: true
}
