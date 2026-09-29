import type { RecurrenceFrequency, RecurringKind } from '../../db/models/index.js'

/** A recurring item as a caller submits it, already shape-checked by the route schema. */
export interface RecurringItemInput {
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** Immutable anchor, `YYYY-MM-DD`. */
  readonly seriesStartDate: string
  /** Last date an occurrence may fall on, inclusive, or `null`/absent for no planned end. */
  readonly endDate?: string | null
  /** The two days of a `semimonthly` item, in either order; defaults to the 1st and 15th. */
  readonly semimonthlyDays?: readonly [number, number] | null
  readonly categoryId?: string | null
  /** Signed amounts: negative leaves the account, positive arrives. */
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}
