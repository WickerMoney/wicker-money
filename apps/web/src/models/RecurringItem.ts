import type { RecurrenceFrequency } from './RecurrenceFrequency.js'
import type { RecurringKind } from './RecurringKind.js'

/** One signed amount on one account. Negative leaves the account. */
export interface RecurringLeg {
  readonly accountId: string
  readonly amount: string
}

/** A recurring item as `GET /recurring-items` returns it. */
export interface RecurringItem {
  readonly id: string
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** Immutable anchor; never shown as "due". */
  readonly seriesStartDate: string
  readonly endDate: string | null
  readonly semimonthlyDays: readonly [number, number] | null
  readonly categoryId: string | null
  /** Negative legs first, so a transfer reads from → to. */
  readonly legs: readonly RecurringLeg[]
  /** Income total, a bill's (negative) amount, or what a transfer moves. */
  readonly amount: string
  readonly monthlyEquivalent: string
  /** Derived by the server against its `today`; `null` once the series has ended. */
  readonly nextDue: string | null
}
