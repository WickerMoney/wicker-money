/** A lump sum being typed into the form. Every amount is text, as typed. */
export interface LumpSumDraft {
  /** `YYYY-MM-DD`, as a date input gives it, or `''`. */
  readonly onDate: string
  /** The whole amount as typed. */
  readonly amount: string
  readonly note: string
  /** The part aimed at each debt as typed, by debt id; a missing or blank entry means none. */
  readonly allocations: Readonly<Record<string, string>>
}
