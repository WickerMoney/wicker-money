import type { AccountType } from '../../db/models/index.js'

/** An account to insert. */
export interface NewAccountInput {
  readonly userId: string
  readonly name: string
  readonly accountType: AccountType
  /** Opening balance as a decimal string. */
  readonly initialBalance: string
  /** ISO 4217 currency code. */
  readonly currencyCode: string
  /** Minimum balance the user wants to keep, as a non-negative decimal string. */
  readonly bufferAmount: string
}
