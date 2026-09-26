import type { Generated, Insertable, Selectable } from 'kysely'
import type { DateOnly, Money, TimestampWithDefault } from './columns.js'
import type { CategorySource } from './CategorySource.js'

/** One ledger entry. Amounts are signed: negative is money out, positive is money in. */
export interface TransactionsTable {
  id: Generated<string>
  user_id: string
  account_id: string
  amount: Money
  merchant: string
  category_id: string | null
  category_source: CategorySource | null
  transaction_date: DateOnly
  notes: string | null
  external_id: string | null
  transfer_account_id: string | null
  /** Links the two legs of one transfer. `null` on everything else. */
  transfer_id: string | null
  is_split: Generated<boolean>
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type Transaction = Selectable<TransactionsTable>

export type NewTransaction = Insertable<TransactionsTable>
