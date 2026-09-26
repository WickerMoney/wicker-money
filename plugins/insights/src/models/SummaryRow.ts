import type { FlowKind } from './FlowKind.js'

/** One category's total for one month, as returned by the monthly-summary endpoint. */
export interface SummaryRow {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /** The category id, or `null` for uncategorized spending. */
  readonly categoryId: string | null
  /** Display name of the category. */
  readonly categoryName: string
  /** Transfers never appear: the server drops them before aggregating. */
  readonly kind: FlowKind
  /** Decimal string. */
  readonly total: string
}
