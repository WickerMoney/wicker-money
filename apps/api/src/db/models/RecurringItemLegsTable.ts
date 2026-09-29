import type { Generated } from 'kysely'
import type { Money, TimestampWithDefault } from './columns.js'

/** Where part of a recurring item's money lands: one signed amount on one account. */
export interface RecurringItemLegsTable {
  id: Generated<string>
  user_id: string
  recurring_item_id: string
  account_id: string
  /** Signed, non-zero; negative leaves the account, positive arrives. */
  amount: Money
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}
