/** One past import run, as listed in the history. */
export interface Batch {
  readonly id: string
  readonly sourceName: string
  readonly fileName: string
  readonly accountName: string
  readonly rowsTotal: number
  readonly rowsImported: number
  readonly rowsSkipped: number
  readonly rowsFlagged: number
  /** ISO timestamp. */
  readonly createdAt: string
  /** ISO timestamp, or `null` while the import is still in effect. */
  readonly revertedAt: string | null
}
