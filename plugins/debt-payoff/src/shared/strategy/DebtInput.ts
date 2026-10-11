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
}
