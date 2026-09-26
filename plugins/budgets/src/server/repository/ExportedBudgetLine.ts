/** One `plugin_budgets.budget_lines` row as it appears in the data export. */
export interface ExportedBudgetLine {
  readonly id: string
  readonly category_id: string
  readonly period_start: string
  readonly period_end: string
  readonly planned: string
  readonly rollover: boolean
  readonly note: string | null
  readonly created_at: string
  readonly updated_at: string
}
