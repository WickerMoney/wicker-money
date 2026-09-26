/** A single transaction to record. */
export interface NewTransaction {
  readonly accountId: string
  /** Signed decimal string: negative is money out. */
  readonly amount: string
  readonly merchant: string
  /** `YYYY-MM-DD`. */
  readonly transactionDate: string
  /** An explicit category. When absent the user's rules choose one. */
  readonly categoryId?: string | null | undefined
  readonly notes?: string | null | undefined
  /** The source's own identifier, used to detect a duplicate on the same account. */
  readonly externalId?: string | null | undefined
  /** Refused when present: a transfer is two rows and has its own operation. */
  readonly transferAccountId?: string | null | undefined
}
