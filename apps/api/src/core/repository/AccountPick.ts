/** An active account as offered to a plugin: identity only, no balances. */
export interface AccountPick {
  /** Account id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Account type, such as `checking`. */
  readonly type: string
}
