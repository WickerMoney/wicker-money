/** Income and expense for one month. Every amount is an exact four-decimal string. */
export interface MonthTotal {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /** Total income for the month. */
  readonly income: string
  /** Total spending for the month; negative when refunds exceeded spending. */
  readonly expense: string
  /** `income - expense`. Negative means the month cost more than it brought in. */
  readonly net: string
}
