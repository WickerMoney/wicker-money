import { occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { Described } from './Described.js'
import { occurrenceKey } from './occurrenceKey.js'
import { describeOccurrence } from './occurrenceState.js'
import type { OpenLeg } from './OpenLeg.js'
import { assertCovers, historiesOf, type RecurringData } from './RecurringData.js'
import type { SuggestionWindow } from './suggestionWindow.js'
import { toSchedule } from './toSchedule.js'

/**
 * The occurrences expected inside a suggestion window, and their unsettled legs.
 * Skipped occurrences are left out.
 *
 * @param data - Loaded data covering the window's `scan`.
 * @param window - The window, from {@link suggestionWindow}.
 * @param today - The user's today.
 * @returns The occurrences by {@link occurrenceKey}, and every leg no transaction has settled.
 * @throws {Error} If `data` does not cover the window's scan.
 */
export function windowOccurrences(
  data: RecurringData,
  window: SuggestionWindow,
  today: string,
): { inWindow: Map<string, Described>; open: OpenLeg[] } {
  assertCovers(data, window.scan, 'windowOccurrences')
  const history = historiesOf(data)
  const inWindow = new Map<string, Described>()
  const open: OpenLeg[] = []
  for (const row of data.items) {
    for (const nominalDate of occurrences(toSchedule(row), window.scan.from, window.scan.to)) {
      const state = describeOccurrence(row, history(row.id), nominalDate, today)
      if (state.status === 'skipped' || state.expectedDate < window.from || state.expectedDate >= window.to) continue
      inWindow.set(occurrenceKey(row.id, nominalDate), { row, state })
      for (const leg of state.legs) {
        if (leg.transaction === null) open.push({ row, state, accountId: leg.accountId, amount: leg.amount })
      }
    }
  }
  return { inWindow, open }
}
