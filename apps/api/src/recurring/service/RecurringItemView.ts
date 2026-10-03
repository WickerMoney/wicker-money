import type { RecurrenceFrequency, RecurringKind } from '../../db/models/index.js'

/** A recurring item as the service returns it: stored fields plus everything derived from "today". */
export interface RecurringItemView {
  readonly id: string
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** Immutable anchor. Never shown as "due"; see {@link nextDue}. */
  readonly seriesStartDate: string
  readonly endDate: string | null
  readonly semimonthlyDays: readonly [number, number] | null
  readonly categoryId: string | null
  /** Negative legs first, so a transfer reads from → to. */
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
  /**
   * The item's headline amount per occurrence: the total for income, the
   * (negative) leg for a bill, and the amount moved (positive) for a transfer
   * or debt payment.
   */
  readonly amount: string
  /** {@link amount} as a monthly rate, for summaries; `0.0000` for `once`. */
  readonly monthlyEquivalent: string
  /**
   * First occurrence on or after today that is still to come, derived, or
   * `null` once the series has ended. Skipped occurrences and ones already
   * settled by a transaction are passed over, and a moved one counts on the
   * date it moved to.
   */
  readonly nextDue: string | null
  /** Whether a transaction has ever been matched to one of its occurrences. Until then nothing is ever late. */
  readonly tracked: boolean
  /** Nominal dates of occurrences that are late: expected in the last week, not yet settled. Oldest first. */
  readonly late: readonly string[]
  readonly createdAt: Date
  readonly updatedAt: Date
}
