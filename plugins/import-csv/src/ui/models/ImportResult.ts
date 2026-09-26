/** The response of the commit endpoint: what was written. */
export interface ImportResult {
  readonly imported: number
  /** Rows skipped because the transaction id is already in the account. */
  readonly skipped: number
  readonly flagged: number
  /** Rows that could not be read. */
  readonly failed: number
  /** `true` when the server recognised the request as a repeat and imported nothing new. */
  readonly replayed?: boolean
}
