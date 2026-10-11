/** A debt as the API returns it. Amounts are decimal strings with four decimal places. */
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
  /** Position in the person's own list; lower comes first. */
  readonly sortOrder: number
  /** Hidden from the list and left out of plans, but kept. */
  readonly archived: boolean
}
