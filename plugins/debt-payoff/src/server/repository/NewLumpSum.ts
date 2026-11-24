/** A lump sum to insert or to replace an existing one with. Already validated. */
export interface NewLumpSum {
  /** `YYYY-MM-DD`. */
  readonly onDate: string
  /** A decimal string, greater than zero. */
  readonly amount: string
  readonly note: string
  /** Parts aimed at the person's own debts, each debt at most once, adding up to no more than `amount`. */
  readonly allocations: readonly { readonly debtId: string; readonly amount: string }[]
}
