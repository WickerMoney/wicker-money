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
  /** First occurrence on or after today, derived, or `null` once the series has ended. */
  readonly nextDue: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}
