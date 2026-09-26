/** Totals across a month's lines. Every amount is a decimal string. */
export interface MonthTotals {
  readonly planned: string
  readonly available: string
  readonly spent: string
  readonly remaining: string
  /** Spending in categories that have no line. */
  readonly unbudgetedSpent: string
  /** Number of lines that are over budget. */
  readonly overCount: number
  /** Number of lines spending faster than the month is arriving. */
  readonly atRiskCount: number
}
