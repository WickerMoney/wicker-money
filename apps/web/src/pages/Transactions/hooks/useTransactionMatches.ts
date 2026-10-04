import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type {
  MatchSuggestion, RecurringOccurrence, Transaction, TransactionCandidates, TransactionMatchList, TransactionMatchSummary,
} from '../../../models/index.js'

/** An occurrence, by what identifies it. */
type OccurrenceRef = Pick<RecurringOccurrence, 'itemId' | 'nominalDate' | 'name'>

/** What {@link useTransactionMatches} returns. */
export interface TransactionMatches {
  /** Each listed transaction with anything to show (linked, suggested or dismissed), by id. */
  readonly byId: ReadonlyMap<string, TransactionMatchSummary>
  /** The open "match to which occurrence?" list, or `null`. One row at a time. */
  readonly picker: TransactionCandidates | null
  /** Loads the occurrences one transaction could settle and opens the list for its row. */
  readonly openPicker: (transaction: Transaction) => Promise<void>
  readonly closePicker: () => void
  /** Records a suggested match. */
  readonly confirm: (transaction: Transaction, suggestion: MatchSuggestion) => Promise<void>
  /** Records a match picked from the list. */
  readonly match: (transaction: Transaction, occurrence: OccurrenceRef) => Promise<void>
  /** The transaction no longer settles the occurrence. */
  readonly unmatch: (transaction: Transaction, occurrence: OccurrenceRef) => Promise<void>
  /** The transaction is not this occurrence: stop suggesting the pair. */
  readonly dismiss: (transaction: Transaction, occurrence: OccurrenceRef) => Promise<void>
  /** Undoes a dismissal. */
  readonly undismiss: (transaction: Transaction, occurrence: OccurrenceRef) => Promise<void>
}

/** The URL of one occurrence. */
const occurrenceUrl = (o: OccurrenceRef) => `/recurring-items/${o.itemId}/occurrences/${o.nominalDate}`

/**
 * Recurring-item matching for the rows on screen: which occurrence each
 * transaction settles, which one is suggested for it, and which it was
 * dismissed for. One request per page of the list, never one per row; the
 * full list of occurrences a transaction could settle is fetched only when
 * the user asks for it.
 *
 * The transaction list itself is not re-read after a change here: matching
 * does not change anything the table shows except this column.
 *
 * @param items - The rows on screen, `null` while loading.
 * @param status - Busy flag and error message shared with the page.
 * @returns The rows' matching state and the actions on it.
 */
export function useTransactionMatches(items: readonly Transaction[] | null, status: ActionStatus): TransactionMatches {
  const [byId, setById] = useState<ReadonlyMap<string, TransactionMatchSummary>>(new Map())
  const [picker, setPicker] = useState<TransactionCandidates | null>(null)
  const latest = useLatestRequest()
  const { show } = status
  // Re-read whenever the list is: an edit to a row's date or amount can change what it looks like.
  const reload = useCallback(() => {
    const ids = (items ?? []).map((t) => t.id).join(',')
    if (ids === '') {
      setById(new Map())
      return Promise.resolve()
    }
    return latest.run(
      (signal) => api.get<TransactionMatchList>(`/recurring-items/transaction-matches?transactionIds=${ids}`, { signal }),
      (list) => setById(new Map(list.transactions.map((t) => [t.transactionId, t]))),
    ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load recurring matches.'))
  }, [items, latest, show])

  useEffect(() => {
    setPicker(null)
    void reload()
    return latest.cancel
  }, [reload, latest])

  const run = async (work: () => Promise<unknown>, failure: string) => {
    status.begin()
    try {
      await work()
      setPicker(null)
      await reload()
    } catch (e) {
      status.show(e instanceof Error ? e.message : failure)
    } finally { status.end() }
  }

  const openPicker = async (t: Transaction) => {
    status.begin()
    try {
      setPicker(await api.get<TransactionCandidates>(`/recurring-items/transaction-matches/${t.id}`))
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not look for recurring items this could be.')
    } finally { status.end() }
  }

  const match = (t: Transaction, o: OccurrenceRef) =>
    run(() => api.post(`${occurrenceUrl(o)}/matches`, { transactionId: t.id }), 'Could not record the match.')

  return {
    byId,
    picker,
    openPicker,
    closePicker: () => setPicker(null),
    confirm: (t, s) => match(t, s.occurrence),
    match,
    unmatch: (t, o) => run(() => api.del(`${occurrenceUrl(o)}/matches/${t.id}`), 'Could not unmatch that transaction.'),
    dismiss: (t, o) =>
      run(() => api.post(`${occurrenceUrl(o)}/dismissals`, { transactionId: t.id }), 'Could not dismiss the suggestion.'),
    undismiss: (t, o) => run(() => api.del(`${occurrenceUrl(o)}/dismissals/${t.id}`), 'Could not undo the dismissal.'),
  }
}
