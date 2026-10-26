import type { Compounding, PromoInterestBase } from '../../shared/index.js'

/** A debt to insert. */
export interface NewDebt {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  readonly accountId: string | null
  /** `undefined` appends after the person's last debt. */
  readonly sortOrder: number | undefined
  readonly archived: boolean
  /** Whether the debt is part of the payoff plan. */
  readonly included: boolean
  /** The earmark: paid toward this debt every month above its minimum, as a decimal string. */
  readonly extraPayment: string
  /** The day repayment begins for a deferred loan, `YYYY-MM-DD`, or `null`. */
  readonly repaymentStartsOn: string | null
  /** The promotional APR percentage as a decimal string, or `null`. Set with `promoEndsOn` or not at all. */
  readonly promoApr: string | null
  /** The promotion's last day, `YYYY-MM-DD`, or `null`. */
  readonly promoEndsOn: string | null
  /** Whether interest is charged back to the start if the promotion ends unpaid. Needs a promotion. */
  readonly promoDeferredInterest: boolean
  /** What that interest is charged on. */
  readonly promoInterestBase: PromoInterestBase
  /** How interest is worked out. */
  readonly compounding: Compounding
}
