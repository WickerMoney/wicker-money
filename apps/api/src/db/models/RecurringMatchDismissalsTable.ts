import type { Generated } from 'kysely'
import type { DateOnly, TimestampWithDefault } from './columns.js'

/**
 * A suggested match the user dismissed: this transaction is not this
 * occurrence, so the pair is never suggested again. The occurrence is named
 * by its item and nominal date rather than by a `recurring_occurrences` row,
 * because those rows come and go as things are recorded on them.
 */
export interface RecurringMatchDismissalsTable {
  id: Generated<string>
  user_id: string
  transaction_id: string
  recurring_item_id: string
  /** The occurrence's nominal date: its identity. */
  nominal_date: DateOnly
  created_at: TimestampWithDefault
}
