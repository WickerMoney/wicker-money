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
}
