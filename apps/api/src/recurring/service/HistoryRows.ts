import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'

/**
 * What describing one occurrence reads, kept apart so a write that changes
 * only some of it can re-read only that part.
 */
export interface HistoryRows {
  /** The item's recorded occurrences on the nominal date. */
  readonly records: readonly OccurrenceRecordRow[]
  /** The transactions settling the item's occurrence on the nominal date. */
  readonly links: readonly OccurrenceLinkRow[]
  /** When matching started for each item matched at least once, ever. */
  readonly trackingStarts: ReadonlyMap<string, string>
}
