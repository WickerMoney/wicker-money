import type { AccountWithBalance } from './AccountWithBalance.js'

/**
 * An account row without its derived balance, in raw database column naming.
 * Cheap to read: it never touches the transactions table.
 */
export type AccountBasic = Pick<
  AccountWithBalance,
  'id' | 'name' | 'account_type' | 'currency_code' | 'spendable' | 'archived_at'
>
