/** One month's total for one category and direction. */
export interface MonthlySummaryRow {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /** The category the money was filed under, or `null` if uncategorized. */
  readonly categoryId: string | null
  /** The category's name, or `Uncategorized`. */
  readonly categoryName: string
  /** Whether the total is money in or money out. */
  readonly kind: 'income' | 'expense'
  /** The summed magnitude as a decimal string. */
  readonly total: string
}
