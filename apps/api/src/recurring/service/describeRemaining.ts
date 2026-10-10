import { describeAt, type WantedOccurrence } from './describeAt.js'
import type { Described } from './Described.js'
import { occurrenceKey } from './occurrenceKey.js'
import type { RecurringData } from './RecurringData.js'

/**
 * {@link describeAt} for the wanted occurrences not already described.
 *
 * The same data and today give the same state, so an occurrence a caller has
 * already described (for example while finding suggestions) is taken from
 * `known` as it is, and only the others are worked out.
 *
 * @param data - Loaded data covering the wanted dates.
 * @param today - The user's today.
 * @param wanted - The occurrences.
 * @param known - Occurrences already described from this `data` and `today`, by {@link occurrenceKey}.
 * @returns What `describeAt` gives for `wanted`: each found occurrence's item and state, by {@link occurrenceKey}.
 * @throws {Error} If `data` does not cover the dates still to be described.
 */
export function describeRemaining(
  data: RecurringData,
  today: string,
  wanted: readonly WantedOccurrence[],
  known: ReadonlyMap<string, Described>,
): Map<string, Described> {
  const found = new Map<string, Described>()
  const rest: WantedOccurrence[] = []
  for (const w of wanted) {
    const hit = known.get(occurrenceKey(w.itemId, w.nominalDate))
    if (hit === undefined) rest.push(w)
    else found.set(occurrenceKey(w.itemId, w.nominalDate), hit)
  }
  for (const [key, described] of describeAt(data, today, rest)) found.set(key, described)
  return found
}
