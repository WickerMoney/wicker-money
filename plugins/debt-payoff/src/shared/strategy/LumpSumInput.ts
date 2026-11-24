/** Part of a lump sum aimed at one particular debt. */
export interface LumpSumAllocationInput {
  /** The debt it is aimed at. A debt that is not in the plan, or has nothing left to pay on that date, takes none of it. */
  readonly debtId: string
  /** How much is aimed at that debt, a decimal string with at most four places, greater than zero. */
  readonly amount: string
}

/**
 * A one-off payment the person plans to make (a bonus, a tax refund), as the
 * engine reads it.
 *
 * It is paid on the first payment date on or after `onDate`, after the month's
 * minimums and earmarks. Each allocation goes to its own debt, capped at what
 * that debt still owes; everything else (the part left unallocated, and any
 * allocation its debt could not take) goes to the debt the active strategy
 * is aiming at, then the next, and so on. A lump sum is outside the monthly
 * pool and never added to it, so it does not roll over into later months.
 */
export interface LumpSumInput {
  /** Opaque identifier, unique within one plan. */
  readonly id: string
  /** The day the money is paid, `YYYY-MM-DD`. */
  readonly onDate: string
  /** The whole amount, a decimal string with at most four places, greater than zero. */
  readonly amount: string
  /** Optional per-debt parts; their total may not be more than `amount`. Each debt at most once. */
  readonly allocations?: readonly LumpSumAllocationInput[]
}
