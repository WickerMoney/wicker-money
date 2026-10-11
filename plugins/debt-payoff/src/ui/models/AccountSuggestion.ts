/** A loan or credit card account a debt could track, from `GET /account-suggestions`. */
export interface AccountSuggestion {
  readonly id: string
  readonly name: string
  readonly accountType: string
  /** The active debt already tracking this account, or `null`. */
  readonly debtId: string | null
}
