import type { Generated, Selectable } from 'kysely'
import type { Money, TimestampWithDefault } from './columns.js'

/** One part of a split transaction, filed under its own category. */
export interface TransactionSplitsTable {
  id: Generated<string>
  user_id: string
  transaction_id: string
  amount: Money
  category_id: string | null
  notes: string | null
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type TransactionSplit = Selectable<TransactionSplitsTable>
