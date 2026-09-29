import type { RecurrenceFrequency, RecurringKind } from '../../db/models/index.js'

/** Everything written for an item: its columns and the full set of legs, which replaces any existing legs. */
export interface RecurringItemWrite {
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  readonly seriesStartDate: string
  readonly endDate: string | null
  /** `[earlier, later]` for `semimonthly`, otherwise `null`. */
  readonly semimonthlyDays: readonly [number, number] | null
  readonly categoryId: string | null
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}
