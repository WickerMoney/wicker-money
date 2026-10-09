/**
 * One transaction on an account, as seeded into the in-memory store for
 * account spending. Only what the account-spend rules look at: no transfers,
 * no splits (the integration tests cover those against a real database).
 */
export interface AccountTransaction {
  readonly userId: string
  readonly accountId: string
  /** `null` for an uncategorized transaction. */
  readonly categoryId: string | null
  /** The transaction date, `YYYY-MM-DD`. */
  readonly date: string
  /** Signed amount as a decimal string: negative for money out. */
  readonly amount: string
}
