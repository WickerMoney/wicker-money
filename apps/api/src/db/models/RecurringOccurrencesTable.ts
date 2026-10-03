import type { Generated } from 'kysely'
import type { DateOnly, TimestampWithDefault } from './columns.js'

/**
 * What was recorded about one occurrence of a recurring item: skipped, or
 * expected on another date. Identified by its item and nominal date; a row
 * exists only once something about the occurrence has been recorded.
 * Transactions that settle it point here (`transactions.recurring_occurrence_id`).
 */
export interface RecurringOccurrencesTable {
  id: Generated<string>
  user_id: string
  recurring_item_id: string
  /** The schedule's date for it; never shifted. */
  nominal_date: DateOnly
  skipped: Generated<boolean>
  /** When it is expected instead of `nominal_date`; `null` when on schedule. */
  expected_date: DateOnly | null
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}
