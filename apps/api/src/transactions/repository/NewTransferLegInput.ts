/** One leg of a transfer to insert. */
export interface NewTransferLegInput {
  readonly userId: string
  /** The account this leg is posted to. */
  readonly accountId: string
  /** The account on the other side of the transfer. */
  readonly counterpartAccountId: string
  /** Signed decimal string: negative on the source account, positive on the destination. */
  readonly amount: string
  readonly merchant: string
  /** `YYYY-MM-DD`. */
  readonly transactionDate: string
  readonly notes: string | null
  /** Shared by both legs of the transfer. */
  readonly transferId: string
  /** The source's own id, the same on both legs; unique per account, like any external id. */
  readonly externalId: string | null
}
