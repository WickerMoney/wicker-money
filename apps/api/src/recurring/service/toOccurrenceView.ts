import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { headlineAmount } from './headlineAmount.js'
import type { OccurrenceState } from './occurrenceState.js'
import type { OccurrenceView } from './OccurrenceView.js'

/**
 * The view of one occurrence.
 *
 * @param row - Its item.
 * @param state - Where it stands.
 * @param date - Where the list places it.
 * @returns The view.
 */
export function toOccurrenceView(row: RecurringItemRow, state: OccurrenceState, date: string): OccurrenceView {
  return {
    itemId: row.id,
    date,
    nominalDate: state.nominalDate,
    expectedDate: state.expectedDate,
    status: state.status,
    moved: state.moved,
    changed: state.changed,
    name: row.name,
    kind: row.kind,
    categoryId: row.category_id,
    amount: headlineAmount(row.kind, state.legs),
    legs: state.legs,
  }
}

