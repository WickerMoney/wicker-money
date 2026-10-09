/** An account as returned by the core account listing that plugins with the `accounts` grant may read. */
export interface AccountOption {
  readonly id: string
  readonly name: string
  /** `checking`, `savings`, `credit_card`, and so on. */
  readonly type: string
}
