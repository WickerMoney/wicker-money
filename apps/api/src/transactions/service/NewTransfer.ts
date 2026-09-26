/** Money moving between two of the user's own accounts. */
export interface NewTransfer {
  /** The account the money leaves. */
  readonly fromAccountId: string
  /** The account the money arrives in. */
  readonly toAccountId: string
  /** A positive magnitude; direction comes from the accounts. */
  readonly amount: string
  /** `YYYY-MM-DD`. */
  readonly transactionDate: string
  /** Label for both legs. Defaults to "Transfer to X" / "Transfer from Y". */
  readonly description?: string | undefined
  readonly notes?: string | null | undefined
}
