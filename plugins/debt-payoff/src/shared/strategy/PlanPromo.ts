import type { PromoInterestBase } from './PromoInterestBase.js'

/** How a debt's promotional rate fares in a plan. */
export interface PlanPromo {
  /** The promotional APR percentage, normalised to four decimal places. */
  readonly apr: string
  /** The promotion's last day, `YYYY-MM-DD`. */
  readonly endsOn: string
  /** Whether interest is charged back to the start if the debt is not cleared in time. */
  readonly deferredInterest: boolean
  /** What that interest is charged on. */
  readonly interestBase: PromoInterestBase
  /** Whether the promotion is still ahead at the plan's first payment. `false` means it has already ended and the balance is taken as it stands. */
  readonly active: boolean
  /** Whether the debt is cleared by the promotion's last day in this plan; `null` when the promotion is not active. */
  readonly clearedInTime: boolean | null
  /** Interest added at the end of the promotion because a balance remained. `0.0000` if none. */
  readonly backdatedInterest: string
  /**
   * The monthly payment that would clear it in time, worked out in the first
   * month it applies (it is paid out of the budget before the strategy is
   * applied), or `null` if the debt has no deferred interest or is not active.
   */
  readonly requiredPayment: string | null
  /** What it needed in its first month that the budget could not cover, which is the extra a month that would clear it in time. `0.0000` if the budget covers it. */
  readonly shortfall: string
}
