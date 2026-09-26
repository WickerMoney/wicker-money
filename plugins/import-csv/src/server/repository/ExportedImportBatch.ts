/** One import batch, in the database's column names. */
export interface ExportedImportBatch {
  readonly id: string
  readonly account_id: string
  readonly source_name: string
  readonly file_name: string
  readonly rows_total: number
  readonly rows_imported: number
  readonly rows_skipped: number
  readonly rows_flagged: number
  readonly created_at: string
  readonly reverted_at: string | null
  readonly idempotency_key: string | null
}
