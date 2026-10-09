import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import type { OccurrenceState } from './occurrenceState.js'

/** An item and one occurrence's state. */
export interface Described {
  readonly row: RecurringItemRow
  readonly state: OccurrenceState
}
