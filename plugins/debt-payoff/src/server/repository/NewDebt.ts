/** A debt to insert. */
export interface NewDebt {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  readonly accountId: string | null
  /** `undefined` appends after the person's last debt. */
  readonly sortOrder: number | undefined
  readonly archived: boolean
  /** Whether the debt is part of the payoff plan. */
  readonly included: boolean
  /** The earmark: paid toward this debt every month above its minimum, as a decimal string. */
  readonly extraPayment: string
}
