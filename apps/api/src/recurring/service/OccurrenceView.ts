import type { RecurringKind } from '../../db/models/index.js'

/** One occurrence of a recurring item on a nominal date. `(itemId, date)` identifies it. */
export interface OccurrenceView {
  readonly itemId: string
  /** Nominal date, `YYYY-MM-DD`. */
  readonly date: string
  readonly name: string
  readonly kind: RecurringKind
  readonly categoryId: string | null
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}
