/** A loan or credit card account a debt could be started from. */
export interface AccountSuggestion {
  readonly id: string
  readonly name: string
  readonly accountType: 'credit_card' | 'loan'
  /** The debt already tracking this account, or `null` if it has none. */
  readonly debtId: string | null
}
