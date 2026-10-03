/**
 * A window as selected from `plugin_budgets.budget_lines`: a line whose period
 * is not exactly one calendar month.
 */
export interface WindowRow {
  readonly id: string
  readonly category_id: string
  /** First day of the window, inclusive, `YYYY-MM-DD`. */
  readonly period_start: string
  /** First day after the window, exclusive, `YYYY-MM-DD`. */
  readonly period_end: string
  /** The amount the window is funded with, as a decimal string. */
  readonly planned: string
  readonly note: string | null
}
