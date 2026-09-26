/** A `plugin_budgets.budget_lines` row as selected by the month queries. */
export interface BudgetLineRow {
  readonly id: string
  readonly category_id: string
  /** The first day of the month, as `YYYY-MM-DD`. */
  readonly period_start: string
  /** The planned amount as a decimal string. */
  readonly planned: string
  readonly rollover: boolean
  readonly note: string | null
}
