import type { RecurrenceFrequency, RecurringKind } from '../../db/models/index.js'

/** One leg of a stored recurring item. */
export interface RecurringLegRow {
  readonly account_id: string
  /** Signed `numeric(19,4)` string. */
  readonly amount: string
}

/** A stored recurring item with its legs, as the repository returns it. */
export interface RecurringItemRow {
  readonly id: string
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** Immutable anchor, `YYYY-MM-DD`. */
  readonly series_start_date: string
  readonly end_date: string | null
  readonly semimonthly_day_1: number | null
  readonly semimonthly_day_2: number | null
  readonly category_id: string | null
  readonly created_at: Date
  readonly updated_at: Date
  /** Ordered by amount, negative first, so a transfer reads from → to. */
  readonly legs: readonly RecurringLegRow[]
}
