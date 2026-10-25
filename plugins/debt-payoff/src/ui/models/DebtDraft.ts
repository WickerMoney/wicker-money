/** A debt being typed into the form. Every field is text, as typed. */
export interface DebtDraft {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  /** The linked account's id, or `''` for none. */
  readonly accountId: string
  readonly archived: boolean
  /** Whether the debt is part of the payoff plan. */
  readonly included: boolean
}
