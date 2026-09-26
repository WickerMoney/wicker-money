import type { Generated } from 'kysely'
import type { DateOnly, Money, TimestampWithDefault } from './columns.js'
import type { RecurrenceFrequency } from './RecurrenceFrequency.js'

/** A repeating expected transaction, such as rent or a salary. */
export interface RecurringItemsTable {
  id: Generated<string>
  user_id: string
  account_id: string
  name: string
  amount: Money
  frequency: RecurrenceFrequency
  series_start_date: DateOnly
  end_date: DateOnly | null
  category_id: string | null
  is_income: Generated<boolean>
  transfer_account_id: string | null
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}
