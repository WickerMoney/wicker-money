/** The account row being edited inline, with its unsaved values. */
export interface AccountEdit {
  /** Id of the account being edited. */
  readonly id: string
  /** Unsaved account name. */
  readonly name: string
  /** Unsaved account type. */
  readonly accountType: string
  /** Unsaved ISO 4217 currency code. */
  readonly currencyCode: string
  /** Unsaved buffer amount, as typed. */
  readonly bufferAmount: string
}
