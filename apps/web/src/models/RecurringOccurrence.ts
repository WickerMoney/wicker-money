import type { OccurrenceStatus } from './OccurrenceStatus.js'
import type { RecurringKind } from './RecurringKind.js'

/** The transaction that settled one leg of an occurrence. */
export interface SettledTransaction {
  readonly id: string
  readonly date: string
  /** What actually posted, signed. */
  readonly amount: string
  readonly merchant: string
}

/** One leg of one occurrence. */
export interface OccurrenceLeg {
  readonly accountId: string
  /** Signed amount expected this time (the occurrence's own if it was changed). */
  readonly amount: string
  readonly transaction: SettledTransaction | null
}

/** One occurrence of a recurring item. `(itemId, nominalDate)` identifies it. */
export interface RecurringOccurrence {
  readonly itemId: string
  /** Where the list places it. */
  readonly date: string
  /** The schedule's date for it; its identity. */
  readonly nominalDate: string
  /** When it is expected: moved, or the nominal date. */
  readonly expectedDate: string
  readonly status: OccurrenceStatus
  readonly moved: boolean
  readonly changed: boolean
  readonly name: string
  readonly kind: RecurringKind
  readonly categoryId: string | null
  /** Income total, a bill's (negative) amount, or what a transfer moves, this time. */
  readonly amount: string
  readonly legs: readonly OccurrenceLeg[]
}

/** `GET /recurring-items/occurrences`. */
export interface RecurringOccurrenceList {
  readonly today: string
  readonly from: string
  readonly to: string
  readonly occurrences: readonly RecurringOccurrence[]
}
