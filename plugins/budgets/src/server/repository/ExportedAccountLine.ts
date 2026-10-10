/** One `plugin_budgets.account_lines` row as it appears in the data export. */
export interface ExportedAccountLine {
  readonly id: string
  readonly account_id: string
  readonly period_start: string
  readonly period_end: string
  readonly planned: string
  readonly rollover: boolean
  readonly excluded_category_ids: readonly string[]
  readonly note: string | null
  readonly created_at: string
  readonly updated_at: string
}
