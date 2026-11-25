/** The part of a lump sum aimed at one debt, as the API returns it. */
export interface LumpSumAllocation {
  /** One of the person's own debts. */
  readonly debtId: string
  /** A decimal string with four places, greater than zero. */
  readonly amount: string
}

/** A lump sum as the API returns it: a one-off payment on a date. */
export interface LumpSum {
  readonly id: string
  /** The day the money is paid, `YYYY-MM-DD`. A date before today is kept but the plan ignores it. */
  readonly onDate: string
  /** The whole amount, a decimal string with four places, greater than zero. */
  readonly amount: string
  /** What it is, in the person's words; empty for none. */
  readonly note: string
  /** The parts aimed at a particular debt. What is left over follows the strategy. Empty when all of it does. */
  readonly allocations: readonly LumpSumAllocation[]
}
