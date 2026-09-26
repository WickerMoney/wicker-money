/** An import batch held by the in-memory store. */
export interface StoredBatch {
  readonly id: string
  readonly userId: string
  readonly accountId: string
  readonly sourceName: string
  readonly fileName: string
  readonly rowsTotal: number
  readonly rowsImported: number
  readonly rowsSkipped: number
  readonly rowsFlagged: number
  readonly idempotencyKey?: string
  revertedAt: Date | null
}
