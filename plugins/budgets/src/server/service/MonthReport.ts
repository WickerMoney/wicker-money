import type { Period } from '../../shared/index.js'
import type { AccountMonthLine } from './AccountMonthLine.js'
import type { MonthLine } from './MonthLine.js'
import type { MonthTotals } from './MonthTotals.js'
import type { UnbudgetedSpend } from './UnbudgetedSpend.js'

/** One month of budget with every figure derived from the ledger. */
export interface MonthReport {
  readonly monthKey: string
  /** Inclusive first and exclusive end dates of the month. */
  readonly period: Period
  /** Today's date in the user's zone, `YYYY-MM-DD`. */
  readonly today: string
  /** True when the month has no stored lines and shows the previous month's as a preview. */
  readonly draft: boolean
  readonly lines: readonly MonthLine[]
  /**
   * Allowances measured against an account rather than a category. Kept out of
   * `lines`, `unbudgeted` and `summary`: what an account line counts is also
   * counted by the category lines, so adding them in would count it twice.
   */
  readonly accountLines: readonly AccountMonthLine[]
  readonly unbudgeted: readonly UnbudgetedSpend[]
  readonly summary: MonthTotals
}
