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
}
