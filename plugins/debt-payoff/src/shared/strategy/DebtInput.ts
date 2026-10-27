import type { Compounding } from './Compounding.js'
import type { PromoInterestBase } from './PromoInterestBase.js'

/**
 * One debt as the engine reads it. All amounts are decimal strings with at
 * most four decimal places, as the rest of the product passes money.
 */
export interface DebtInput {
  /** Opaque identifier, unique within one plan. */
  readonly id: string
  /** What the person calls it; carried through to the plan and never interpreted. */
  readonly name: string
  /** What is owed now, as of the plan's start date. Zero means it is already paid. */
  readonly balance: string
  /** The annual percentage rate as a percentage, such as `'24.9900'` for 24.99%. Zero is allowed. */
  readonly apr: string
  /** The least the lender requires each month. Zero is allowed. */
  readonly minimumPayment: string
  /**
   * Extra the person pays toward this debt every month, on top of its minimum
   * and outside the shared extra (an "earmark"). Optional; left out means
   * `'0'`. Zero is allowed.
   */
  readonly extraPayment?: string
  /**
   * The day repayment begins, `YYYY-MM-DD`, for a loan in deferment. Until the
   * first plan month that falls on or after it, no minimum is due, the pooled
   * money skips the debt (only its earmark can pay it) and interest accrues and
   * is added to the balance. Left out or `null` means repayment has begun.
   */
  readonly repaymentStartsOn?: string | null
  /** The promotional APR percentage, used until `promoEndsOn`. Set with `promoEndsOn` or not at all. `'0'` is a 0% promotion. */
  readonly promoApr?: string | null
  /** The last day of the promotion, `YYYY-MM-DD`. A payment dated on or before it is inside the promotion. */
  readonly promoEndsOn?: string | null
  /**
   * Whether interest is charged back to the start if the debt is not cleared
   * by `promoEndsOn` ("no interest if paid in full"). Needs a promotion.
   * Default `false`.
   */
  readonly promoDeferredInterest?: boolean
  /** What backdated interest is charged on. Default `'original'`. */
  readonly promoInterestBase?: PromoInterestBase
  /** How interest is worked out each month. Default `'monthly'`. */
  readonly compounding?: Compounding
}
