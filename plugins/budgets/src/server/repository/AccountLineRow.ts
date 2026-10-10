/** A `plugin_budgets.account_lines` row as selected by the month queries. */
export interface AccountLineRow {
  readonly id: string
  readonly account_id: string
  /** The first day of the month, as `YYYY-MM-DD`. */
  readonly period_start: string
  /** The planned amount as a decimal string. */
  readonly planned: string
  readonly rollover: boolean
  /** Categories whose spending does not count against the line; stale ids are harmless. */
  readonly excluded_category_ids: readonly string[]
  readonly note: string | null
}
