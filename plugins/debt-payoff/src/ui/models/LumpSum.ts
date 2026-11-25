/** The part of a lump sum aimed at one debt, as the plugin's API returns it. */
export interface LumpSumAllocation {
  readonly debtId: string
  /** A decimal string with four places. */
  readonly amount: string
}

/** A lump sum as the plugin's API returns it: a one-off payment on a date. */
export interface LumpSum {
  readonly id: string
  /** The day the money is paid, `YYYY-MM-DD`. */
  readonly onDate: string
  /** The whole amount, a decimal string with four places. */
  readonly amount: string
  /** What it is, in the person's words; `''` for none. */
  readonly note: string
  /** The parts aimed at a particular debt. What is left over follows the strategy. */
  readonly allocations: readonly LumpSumAllocation[]
}
