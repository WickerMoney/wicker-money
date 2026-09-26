/** The fields the spend and transfer forms share, so switching mode keeps what was typed. */
export interface EntryFields {
  /** The account the entry is recorded against (the source account for a transfer). */
  readonly accountId: string
  /** Chooses the account. */
  readonly setAccountId: (id: string) => void
  /** The merchant, or the description of a transfer. */
  readonly merchant: string
  /** Sets the merchant text. */
  readonly setMerchant: (text: string) => void
  /** The transaction date, `YYYY-MM-DD`. */
  readonly date: string
  /** Sets the date. */
  readonly setDate: (date: string) => void
}
