import type { Compounding } from './Compounding.js'
import type { PlanPromo } from './PlanPromo.js'

/** How one debt fares in a plan. */
export interface PlanDebt {
  /** The debt. */
  readonly id: string
  /** Its name, as given. */
  readonly name: string
  /** What was owed at the start, normalised to four decimal places. */
  readonly startingBalance: string
  /** The APR percentage, normalised to four decimal places. */
  readonly apr: string
  /** Its minimum payment, normalised to four decimal places. */
  readonly minimumPayment: string
  /** Its earmark: the extra paid to this debt every month above its minimum, normalised to four decimal places. `0.0000` if none. */
  readonly extraPayment: string
  /**
   * Whether the earmark alone is at least what was owed at the start, so the
   * debt would be cleared in month 1 and part of the earmark goes unused.
   * Usually a typo; the page says so. `false` when there is no earmark.
   */
  readonly earmarkCoversBalance: boolean
  /**
   * Whether the minimum is at least the first month's interest. `false` means
   * paying only the minimum would never reduce this debt; it is paid off only
   * if extra money is aimed at it or freed up elsewhere.
   */
  readonly minimumCoversInterest: boolean
  /** The month it reaches zero (0 if it started at zero), or `null` if it does not within the plan. */
  readonly payoffMonth: number | null
  /** The date of that payment, or `null`. A debt that started at zero is paid off on the start date. */
  readonly payoffDate: string | null
  /** Interest this debt accrues over the plan. */
  readonly totalInterest: string
  /** Everything paid to this debt over the plan. */
  readonly totalPaid: string
  /** The day repayment begins for a deferred loan, as given, or `null` if repayment has begun. */
  readonly repaymentStartsOn: string | null
  /** The first plan month a minimum is due: `1` unless the debt is deferred. */
  readonly repaymentStartMonth: number
  /** How its interest is worked out. */
  readonly compounding: Compounding
  /** Its promotional rate, or `null` if it has none. */
  readonly promo: PlanPromo | null
}
