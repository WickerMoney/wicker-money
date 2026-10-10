import { addDays } from '@wickermoney/plugin-sdk/recurrence'
import { MAX_MOVE_DAYS } from './OCCURRENCE_RULES.js'
import type { DateRange } from './RecurringData.js'

/** How far back suggestions look: two weeks covers a late paycheck plus a missed weekly check-in. */
export const SUGGEST_LOOKBACK_DAYS = 14
/** How far ahead suggestions look, for money that arrives before its date. */
export const SUGGEST_LOOKAHEAD_DAYS = 5

/** The dates suggestions are made for. */
export interface SuggestionWindow {
  /** First expected date, inclusive. */
  readonly from: string
  /** Last expected date plus one, exclusive. */
  readonly to: string
  /** The nominal dates to read: the window widened by how far an occurrence can be moved. */
  readonly scan: DateRange
}

/**
 * The window suggestions cover.
 *
 * @param today - The user's today.
 * @returns The window of expected dates and the nominal dates that can land in it.
 */
export function suggestionWindow(today: string): SuggestionWindow {
  const from = addDays(today, -SUGGEST_LOOKBACK_DAYS)
  const to = addDays(today, SUGGEST_LOOKAHEAD_DAYS + 1)
  return { from, to, scan: { from: addDays(from, -MAX_MOVE_DAYS), to: addDays(to, MAX_MOVE_DAYS) } }
}
