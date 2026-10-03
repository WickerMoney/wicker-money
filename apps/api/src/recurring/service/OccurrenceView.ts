import type { RecurringKind } from '../../db/models/index.js'
import type { OccurrenceStatus } from './OccurrenceStatus.js'
import type { SettledBy } from './occurrenceState.js'

/** One leg of an occurrence. */
export interface OccurrenceLegView {
  readonly accountId: string
  /** Signed amount expected this time: the occurrence's own if it was changed, otherwise the item's. */
  readonly amount: string
  /** The transaction that settled this leg, or `null` while it has not arrived. */
  readonly transaction: SettledBy | null
}

/**
 * One occurrence of a recurring item. `(itemId, nominalDate)` identifies it;
 * the dates around it say where it lands.
 */
export interface OccurrenceView {
  readonly itemId: string
  /**
   * Where this list places it, `YYYY-MM-DD`: its expected date, except in a
   * projection (upcoming, forecast), where a late occurrence is placed on the
   * first projected day because that is the earliest it can still arrive.
   */
  readonly date: string
  /** The schedule's date for it; its identity, never shifted. */
  readonly nominalDate: string
  /** When it is expected: moved, or the nominal date. */
  readonly expectedDate: string
  readonly status: OccurrenceStatus
  /** Whether it was moved off its nominal date. */
  readonly moved: boolean
  /** Whether its amount differs from the item's this time. */
  readonly changed: boolean
  readonly name: string
  readonly kind: RecurringKind
  readonly categoryId: string | null
  /** This occurrence's headline amount: income total, a bill's (negative) amount, or what a transfer moves. */
  readonly amount: string
  readonly legs: readonly OccurrenceLegView[]
}
