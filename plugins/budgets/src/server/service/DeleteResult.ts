/** The outcome of deleting a budget line. */
export interface DeleteResult {
  /** Rows deleted; 1 for a successful delete. */
  readonly removed: number
}
