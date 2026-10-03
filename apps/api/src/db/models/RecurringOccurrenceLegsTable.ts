import type { Generated } from 'kysely'
import type { Money, TimestampWithDefault } from './columns.js'

/** One leg's amount for one occurrence, in place of the item's amount on that account. */
export interface RecurringOccurrenceLegsTable {
  id: Generated<string>
  user_id: string
  recurring_occurrence_id: string
  account_id: string
  /** Signed, non-zero; same convention as the item's legs. */
  amount: Money
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}
