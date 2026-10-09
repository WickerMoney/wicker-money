import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { DismissalRow } from '../repository/DismissalRow.js'
import { compare } from './compare.js'
import type { Described } from './Described.js'
import type { DismissedSuggestion } from './MatchSuggestion.js'
import { occurrenceKey } from './occurrenceKey.js'
import { toOccurrenceView } from './toOccurrenceView.js'

/**
 * The dismissed pairs that can be undone: the occurrence is in the window
 * and the transaction settles nothing, since otherwise the dismissal
 * changes nothing.
 *
 * @param dismissals - The user's dismissals.
 * @param inWindow - The window's occurrences, by {@link occurrenceKey}.
 * @param transactions - The dismissed transactions, by id (a missing one is left out).
 * @returns The dismissed pairs, by expected date, then name, then transaction id.
 */
export function buildDismissed(
  dismissals: readonly DismissalRow[],
  inWindow: ReadonlyMap<string, Described>,
  transactions: ReadonlyMap<string, CandidateTransactionRow>,
): DismissedSuggestion[] {
  const dismissed: DismissedSuggestion[] = []
  for (const d of dismissals) {
    const found = inWindow.get(occurrenceKey(d.recurring_item_id, d.nominal_date))
    const tx = transactions.get(d.transaction_id)
    if (tx === undefined || found === undefined || tx.recurring_occurrence_id !== null) continue
    dismissed.push({
      occurrence: toOccurrenceView(found.row, found.state, found.state.expectedDate),
      accountId: tx.account_id,
      transaction: { id: tx.id, date: tx.transaction_date, amount: tx.amount, merchant: tx.merchant },
    })
  }
  return dismissed.sort((a, b) => compare(a.occurrence.expectedDate, b.occurrence.expectedDate)
    || compare(a.occurrence.name, b.occurrence.name) || compare(a.transaction.id, b.transaction.id))
}
