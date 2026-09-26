/** One row of the monthly summary query: a month's total for one category and direction. */
export interface MonthlyTotalRow {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /** The category the money was filed under, or `null` if uncategorized. */
  readonly category_id: string | null
  /** The category's name, or `null` if uncategorized. */
  readonly category_name: string | null
  /** Whether the total is money in or money out. */
  readonly kind: 'income' | 'expense'
  /** The summed magnitude as a numeric string, to avoid floating-point loss. */
  readonly total: string
}
