/** The transaction fields the host's rule engine evaluates a rule's conditions against. */
export interface RuleSubject {
  /** Merchant text. */
  readonly merchant: string
  /** Free-text notes or description, if any. */
  readonly notes?: string | null
  /** Signed decimal string as stored on the ledger; negative is money out. */
  readonly amount: string
}
