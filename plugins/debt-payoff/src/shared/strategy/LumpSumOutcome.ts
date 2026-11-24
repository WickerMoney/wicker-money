/** Why a lump sum did or did not change the plan. */
export type LumpSumStatus =
  /** It falls on a payment date inside the plan. How much of it was needed is in `paid`; `amount` is `paid` plus `unused`. */
  | 'applied'
  /** It is dated before the day the balances are as of, so those balances already include it. The plan ignores it. */
  | 'past'
  /** It is dated after the last month the plan covers. The plan ignores it. */
  | 'beyond_limit'

/** What the plan did with one lump sum. Present on a plan only when it was given lump sums. */
export interface LumpSumOutcome {
  /** The lump sum's id as given. */
  readonly id: string
  /** The date it was set for. */
  readonly onDate: string
  /** The whole amount, normalised to four decimal places. */
  readonly amount: string
  readonly status: LumpSumStatus
  /** The plan month it was paid in (1 is the first), or `null` when it was ignored. */
  readonly month: number | null
  /** The payment date of that month, or `null` when it was ignored. */
  readonly date: string | null
  /** What was paid to debts: `'0.0000'` when ignored. */
  readonly paid: string
  /**
   * What was not paid to any debt: everything when ignored, and when it applied
   * the part left over because every debt was already paid off or not yet due.
   */
  readonly unused: string
}
