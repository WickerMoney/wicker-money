/** What replacing an account's opening balance would do to its derived balance; all values are decimal strings. */
export interface InitialBalancePreview {
  readonly currentInitialBalance: string
  readonly currentBalance: string
  readonly newInitialBalance: string
  readonly newBalance: string
  /** New opening balance minus the current one; the amount every historical balance would shift by. */
  readonly delta: string
}
