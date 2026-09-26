import type { SummaryRow } from './SummaryRow.js'

/** The response of `GET /core/transactions/monthly-summary`. */
export interface SummaryResponse {
  /** How many months back the aggregate covers. */
  readonly months: number
  /** One row per month, category and flow kind. */
  readonly rows: readonly SummaryRow[]
}
