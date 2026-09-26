/** A ledger row held by the in-memory store. */
export interface StoredTransaction {
  readonly id: string
  readonly userId: string
  readonly accountId: string
  readonly amount: string
  readonly merchant: string
  readonly date: string
  readonly externalId: string | null
  readonly categoryId: string | null
  /** Set by a test to simulate an edit, split, hand categorisation or transfer conversion. */
  touched: boolean
}
