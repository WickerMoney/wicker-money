import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { groupHistories, type ItemHistory } from './occurrenceState.js'

/** A span of nominal dates: `from` on or after, `to` before, both `YYYY-MM-DD`. */
export interface DateRange {
  readonly from: string
  readonly to: string
}

/**
 * What describing recurring occurrences reads, loaded once and then passed
 * to pure functions ({@link describeAt}, {@link windowOccurrences}, ...).
 *
 * Scope and lifetime: one value belongs to one request. It is built by
 * {@link loadRecurringData} from the repositories of one unit of work, which
 * run in one transaction under one user's row-level security, and is dropped
 * when that unit of work's callback returns. It is a plain immutable object:
 * never store it on a service, in a module or in any cache, and never hand it
 * to another request or user.
 *
 * It is a snapshot. Anything that writes matches, links, records or items must
 * not read through a value loaded before the write; reload after writing.
 * Today only read-only requests use it.
 */
export interface RecurringData {
  /** The nominal dates `records` and `links` cover; reading outside it is a programming error. */
  readonly range: DateRange
  /** The user's items, in the repository's order. */
  readonly items: readonly RecurringItemRow[]
  /** Recorded occurrences with a nominal date in `range`. */
  readonly records: readonly OccurrenceRecordRow[]
  /** Transactions settling occurrences with a nominal date in `range`. */
  readonly links: readonly OccurrenceLinkRow[]
  /** When matching started for each item matched at least once, ever (not only within `range`). */
  readonly trackingStarts: ReadonlyMap<string, string>
}

/**
 * The span covering all of some others.
 *
 * @param ranges - Any number of spans.
 * @returns The earliest start to the latest end, or `null` for none.
 */
export function rangeCovering(ranges: readonly DateRange[]): DateRange | null {
  const [first, ...rest] = ranges
  if (first === undefined) return null
  return rest.reduce<DateRange>(
    (all, r) => ({ from: r.from < all.from ? r.from : all.from, to: r.to > all.to ? r.to : all.to }),
    first,
  )
}

/**
 * Checks the loaded data reaches as far as a caller reads, since a history
 * built from too narrow a load would silently look like "nothing recorded".
 *
 * @param data - The loaded data.
 * @param need - The nominal dates the caller will look up.
 * @param caller - Who is asking, for the message.
 * @throws {Error} If `need` is not within `data.range`.
 */
export function assertCovers(data: RecurringData, need: DateRange, caller: string): void {
  if (need.from < data.range.from || need.to > data.range.to) {
    throw new Error(`${caller} needs ${need.from}..${need.to} but the data covers ${data.range.from}..${data.range.to}`)
  }
}

/**
 * Groups the loaded records and links by item.
 *
 * @param data - The loaded data.
 * @returns Each item's history; see {@link groupHistories}.
 */
export function historiesOf(data: RecurringData): (itemId: string) => ItemHistory {
  return groupHistories(data.records, data.links, data.trackingStarts)
}
