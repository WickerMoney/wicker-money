/** One saved source mapping, in the database's column names. */
export interface ExportedSourceMapping {
  readonly id: string
  readonly source_name: string
  readonly columns: Record<string, string>
  readonly date_format: string
  readonly amount_style: string
  readonly invert_amount: boolean
  readonly created_at: string
  readonly updated_at: string
}
