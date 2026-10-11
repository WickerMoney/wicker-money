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
}
