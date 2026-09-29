/** One account row together with its derived balance, in raw database column naming. */
export interface AccountWithBalance {
  id: string
  name: string
  account_type: string
  initial_balance: string
  currency_code: string
  buffer_amount: string
  /** Whether the account counts toward safe to spend. */
  spendable: boolean
  archived_at: Date | null
  created_at: Date
  updated_at: Date
  /** The opening balance plus the sum of the account's transaction amounts, as a decimal string. */
  balance: string
}
