/** A debt as the plugin's API returns it. Amounts are decimal strings with four places. */
export interface Debt {
  readonly id: string
  readonly name: string
  /** What is owed now. */
  readonly balance: string
  /** The annual percentage rate as a percentage: `'24.9900'` is 24.99%. */
  readonly apr: string
  /** The least the lender requires each month. */
  readonly minimumPayment: string
  /** The loan or credit card account it tracks, or `null`. */
  readonly accountId: string | null
  readonly sortOrder: number
  /** Hidden from plans, but kept. */
  readonly archived: boolean
  /** Whether the debt is part of the payoff plan. `false` keeps it in the list but out of the plan and its date. */
  readonly included: boolean
  /** Extra paid toward this debt every month on top of its minimum, apart from the extra for all debts. `'0.0000'` for none. */
  readonly extraPayment: string
  /** The day repayment begins for a loan in deferment, `YYYY-MM-DD`, or `null` if it has begun. */
  readonly repaymentStartsOn: string | null
  /** The promotional rate as a percentage, or `null` for none. */
  readonly promoApr: string | null
  /** The promotion's last day, `YYYY-MM-DD`, or `null`. */
  readonly promoEndsOn: string | null
  /** Whether interest is charged back to the start if it is not paid off by `promoEndsOn`. */
  readonly promoDeferredInterest: boolean
  /** What that backdated interest is charged on. */
  readonly promoInterestBase: 'original' | 'declining'
  /** How interest is worked out each month. */
  readonly compounding: 'monthly' | 'daily' | 'daily_simple'
}
