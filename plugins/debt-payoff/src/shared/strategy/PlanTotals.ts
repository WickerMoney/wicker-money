/** The outcome of one scenario, which is all the minimums-only comparison needs. */
export interface PlanTotals {
  /** Months until the last debt is paid, or the months simulated if it was capped. */
  readonly months: number
  /** Interest accrued over those months. */
  readonly totalInterest: string
  /** The date of the final payment, or `null` if the scenario was capped. */
  readonly debtFreeDate: string | null
  /** Whether the scenario stopped at a limit with something still owing. */
  readonly capped: boolean
}
