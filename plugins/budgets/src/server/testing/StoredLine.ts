import type { BudgetLineRow } from '../repository/BudgetLineRow.js'

/** A budget line with the user it belongs to, as the in-memory store keeps it. */
export interface StoredLine extends BudgetLineRow {
  readonly userId: string
  /** Last day of the month, `YYYY-MM-DD`. */
  readonly period_end: string
}
