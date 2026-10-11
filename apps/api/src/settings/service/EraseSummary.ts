/** What erasing one user's data removed. */
export interface EraseSummary {
  /** Rows deleted across every table, sessions included. */
  readonly rows: number
}
