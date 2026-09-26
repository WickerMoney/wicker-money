import type { MonthlySummaryRow } from './MonthlySummaryRow.js'

/** Income and expense per month per category. */
export interface MonthlySummary {
  /** How many months, ending with the current one, the summary covers. */
  readonly months: number
  /** Totals, oldest month first. */
  readonly rows: readonly MonthlySummaryRow[]
}
