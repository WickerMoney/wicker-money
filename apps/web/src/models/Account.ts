/** A ledger account as returned by `GET /accounts`. */
export interface Account {
  /** The account id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One of `checking`, `savings`, `credit_card`, `loan` or `investment`. */
  readonly accountType: string
  /** Decimal string. The balance the account was opened with. */
  readonly initialBalance: string
  /** Decimal string. The opening balance plus every recorded transaction. */
  readonly balance: string
  /** ISO 4217 currency code. */
  readonly currencyCode: string
  /** Decimal string. Amount held back from "available" figures. */
  readonly bufferAmount: string
  /**
   * Counts toward safe to spend on the "Until payday" widget. Only checking
   * and savings can; checking starts on, savings off.
   */
  readonly spendable: boolean
  /** ISO timestamp, or `null` for an active account. */
  readonly archivedAt: string | null
}
