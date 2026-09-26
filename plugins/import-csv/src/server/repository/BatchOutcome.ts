/** The recorded result of an import batch, as far as a repeated request needs to report it. */
export interface BatchOutcome {
  /** The batch id. */
  readonly id: string
  /** Rows written to the ledger. */
  readonly rowsImported: number
  /** Rows not written because they were duplicates or lost a race. */
  readonly rowsSkipped: number
  /** Rows flagged as possible duplicates. */
  readonly rowsFlagged: number
}
