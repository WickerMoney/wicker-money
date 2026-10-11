/** What a debt is created with. Amounts are already validated, normalised decimal strings. */
export interface NewDebtInput {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  readonly accountId?: string | null
  /** Defaults to after the last debt. */
  readonly sortOrder?: number
  readonly archived?: boolean
}

/** The fields of a debt that can be changed; any not sent keep their value. */
export interface DebtChanges {
  readonly name?: string
  readonly balance?: string
  readonly apr?: string
  readonly minimumPayment?: string
  readonly accountId?: string | null
  readonly sortOrder?: number
  readonly archived?: boolean
}
