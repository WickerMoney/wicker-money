/** One import batch as the history list shows it. */
export interface BatchListRow {
  /** The batch id. */
  readonly id: string
  /** The source name the file was imported under. */
  readonly sourceName: string
  /** The uploaded file's name. */
  readonly fileName: string
  /** Rows that mapped cleanly. */
  readonly rowsTotal: number
  /** Rows written to the ledger. */
  readonly rowsImported: number
  /** Rows not written because they were duplicates or lost a race. */
  readonly rowsSkipped: number
  /** Rows flagged as possible duplicates. */
  readonly rowsFlagged: number
  /** When the batch was created. */
  readonly createdAt: Date
  /** When the batch was reverted, or `null` if it has not been. */
  readonly revertedAt: Date | null
  /** Name of the account the file was imported into. */
  readonly accountName: string
}
