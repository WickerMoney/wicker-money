import type { AccountType } from '../../db/models/index.js'

/** An account to create. */
export interface NewAccount {
  readonly name: string
  readonly accountType: AccountType
  /** Opening balance as a decimal string. */
  readonly initialBalance: string
  /** ISO 4217 currency code. */
  readonly currencyCode: string
  /** Minimum balance the user wants to keep, as a non-negative decimal string. */
  readonly bufferAmount: string
  /**
   * Whether the account counts toward safe to spend. Omitted means the
   * default for its type: checking yes, everything else no.
   */
  readonly spendable?: boolean | undefined
}
