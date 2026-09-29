import type { Generated, Insertable, Selectable, Updateable } from 'kysely'
import type { MoneyWithDefault, Timestamp, TimestampWithDefault } from './columns.js'
import type { AccountType } from './AccountType.js'

/** A place money lives: a bank account, card, loan or investment. */
export interface AccountsTable {
  id: Generated<string>
  user_id: string
  name: string
  account_type: AccountType
  initial_balance: MoneyWithDefault
  currency_code: Generated<string>
  buffer_amount: MoneyWithDefault
  /** Counts toward safe to spend. Only checking and savings may be true (migration 022). */
  spendable: Generated<boolean>
  archived_at: Timestamp | null
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type Account = Selectable<AccountsTable>

export type NewAccount = Insertable<AccountsTable>

export type AccountUpdate = Updateable<AccountsTable>
