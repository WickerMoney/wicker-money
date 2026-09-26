/** The effect of changing an account's opening balance, as returned by the preview endpoint. */
export interface BalancePreview {
  /** The stored opening balance, as a decimal string. */
  readonly currentInitialBalance: string
  /** The balance today, as a decimal string. */
  readonly currentBalance: string
  /** The opening balance that would be stored, as a decimal string. */
  readonly newInitialBalance: string
  /** The balance that would result today, as a decimal string. */
  readonly newBalance: string
  /** Signed decimal string: the change applied to every historical balance. */
  readonly delta: string
}
