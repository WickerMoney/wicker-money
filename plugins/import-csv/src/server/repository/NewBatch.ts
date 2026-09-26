/** The values recorded when an import batch is created. */
export interface NewBatch {
  /** The account the file was imported into. */
  readonly accountId: string
  /** The source name the file was imported under. */
  readonly sourceName: string
  /** The uploaded file's name, already truncated to the column width. */
  readonly fileName: string
  /** Rows that mapped cleanly. */
  readonly rowsTotal: number
  /** Rows written to the ledger. */
  readonly rowsImported: number
  /** Rows not written because they were duplicates or lost a race. */
  readonly rowsSkipped: number
  /** Rows flagged as possible duplicates. */
  readonly rowsFlagged: number
  /**
   * The client's key for this commit, when it sent one. At most one batch per
   * user can carry a given key.
   */
  readonly idempotencyKey?: string
}
