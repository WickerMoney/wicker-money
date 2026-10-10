import { addDays, occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { Described } from './Described.js'
import { occurrenceKey } from './occurrenceKey.js'
import { describeOccurrence } from './occurrenceState.js'
import { assertCovers, historiesOf, type DateRange, type RecurringData } from './RecurringData.js'
import { toSchedule } from './toSchedule.js'

/** An occurrence to look up. */
export interface WantedOccurrence {
  readonly itemId: string
  readonly nominalDate: string
}

/**
 * The span of nominal dates some occurrences fall in.
 *
 * @param wanted - At least one occurrence.
 * @returns From the earliest date to the day after the latest.
 */
export function wantedRange(wanted: readonly WantedOccurrence[]): DateRange {
  const dates = wanted.map((w) => w.nominalDate).sort()
  return { from: dates[0] as string, to: addDays(dates[dates.length - 1] as string, 1) }
}

/**
 * Works out the state of some occurrences from data already loaded.
 * Occurrences whose item is gone, or whose date the schedule no longer has,
 * are left out.
 *
 * @param data - Loaded data covering {@link wantedRange} of `wanted`.
 * @param today - The user's today.
 * @param wanted - The occurrences.
 * @returns Each found occurrence's item and state, by {@link occurrenceKey}.
 * @throws {Error} If `data` does not cover the wanted dates.
 */
export function describeAt(
  data: RecurringData,
  today: string,
  wanted: readonly WantedOccurrence[],
): Map<string, Described> {
  const found = new Map<string, Described>()
  if (wanted.length === 0) return found
  assertCovers(data, wantedRange(wanted), 'describeAt')
  const history = historiesOf(data)
  const items = new Map(data.items.map((r) => [r.id, r]))
  for (const { itemId, nominalDate } of wanted) {
    const row = items.get(itemId)
    if (row === undefined) continue
    if (occurrences(toSchedule(row), nominalDate, addDays(nominalDate, 1)).length === 0) continue
    found.set(occurrenceKey(itemId, nominalDate), { row, state: describeOccurrence(row, history(itemId), nominalDate, today) })
  }
  return found
}
