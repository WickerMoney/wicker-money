/** A `core.accounts` row, reduced to what naming and checking an account line needs. */
export interface AccountRow {
  readonly id: string
  readonly name: string
  /** The account type, such as `checking` or `savings`. */
  readonly account_type: string
}
