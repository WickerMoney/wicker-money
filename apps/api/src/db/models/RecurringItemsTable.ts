import type { Generated } from 'kysely'
import type { DateOnly, TimestampWithDefault } from './columns.js'
import type { RecurrenceFrequency } from './RecurrenceFrequency.js'
import type { RecurringKind } from './RecurringKind.js'

/**
 * A repeating expected transaction, such as rent or a salary: the schedule and
 * its kind. Where the money lands is in `core.recurring_item_legs`.
 */
export interface RecurringItemsTable {
  id: Generated<string>
  user_id: string
  name: string
  kind: RecurringKind
  frequency: RecurrenceFrequency
  /** Immutable anchor; "next due" is always derived from it. */
  series_start_date: DateOnly
  end_date: DateOnly | null
  /** The two days of a `semimonthly` item (day 1 < day 2); `null` for every other frequency. */
  semimonthly_day_1: number | null
  semimonthly_day_2: number | null
  category_id: string | null
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}
