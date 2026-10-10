import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
 * How long a new set of rows must hold still before its matches are requested.
 * Paging through quickly would otherwise issue a request for every page passed
 * through; only the page the user stops on needs its matches.
 */
export const MATCHES_DEBOUNCE_MS = 150

/**
 * Recurring-item matching for the rows on screen: which occurrence each
 * transaction settles, which one is suggested for it, and which it was
 * dismissed for. One request per page of the list, never one per row; the
 * full list of occurrences a transaction could settle is fetched only when
 * the user asks for it.
 *
 * Matches are requested for the ids on screen, so a re-read of the list that
 * returns the same rows costs nothing. Two things make it ask again: the ids
 * changing (a page turn or a filter, debounced so that a burst of them makes
 * one request; the first rows are requested at once) and `revision` changing (the user edited something, so a row's
 * date or amount, and therefore what it looks like, may have changed). The
 * second is requested at once, alongside the list re-read that caused it,
 * because the ids it needs are the ones already on screen; if the re-read
 * turns out to return different rows, those are requested after it and the
 * earlier answer is dropped. A response is only applied while it is still the
 * latest question asked.
 *
 * The transaction list itself is not re-read after a change here: matching
 * does not change anything the table shows except this column.
 *
 * @param items - The rows on screen, `null` while loading.
 * @param status - Busy flag and error message shared with the page.
 * @param revision - Bumped by the page whenever it re-reads the list after a change.
 * @returns The rows' matching state and the actions on it. The object keeps its
 *   identity until the matches or the open list change.
 */
export function useTransactionMatches(
  items: readonly Transaction[] | null, status: ActionStatus, revision = 0,
): TransactionMatches {
  const [byId, setById] = useState<ReadonlyMap<string, TransactionMatchSummary>>(new Map())
  const [picker, setPicker] = useState<TransactionCandidates | null>(null)
  const latest = useLatestRequest()
  const { begin, end, show } = status
  const idsKey = useMemo(() => (items ?? []).map((t) => t.id).join(','), [items])
  // What `reload` asks about, without making every action depend on the rows.
  const idsRef = useRef(idsKey)
  idsRef.current = idsKey

  const load = useCallback((ids: string) => {
    if (ids === '') {
      latest.cancel()
      setById(new Map())
      return Promise.resolve()
    }
    return latest.run(
      (signal) => api.get<TransactionMatchList>(`/recurring-items/transaction-matches?transactionIds=${ids}`, { signal }),
      (list) => setById(new Map(list.transactions.map((t) => [t.transactionId, t]))),
    ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load recurring matches.'))
  }, [latest, show])

  const lastRevision = useRef(revision)
  const asked = useRef(false)
  useEffect(() => {
    setPicker(null)
    const edited = lastRevision.current !== revision
    lastRevision.current = revision
    // The first rows are asked about straight away; waiting is only worth it
    // when the rows are being replaced, as in a burst of page turns.
    if (edited || idsKey === '' || !asked.current) {
      if (idsKey !== '') asked.current = true
      void load(idsKey)
      return latest.cancel
    }
    const timer = setTimeout(() => { void load(idsKey) }, MATCHES_DEBOUNCE_MS)
    return () => { clearTimeout(timer); latest.cancel() }
  }, [idsKey, revision, load, latest])

  const run = useCallback(async (work: () => Promise<unknown>, failure: string) => {
    begin()
    try {
      await work()
      setPicker(null)
      await load(idsRef.current)
    } catch (e) {
      show(e instanceof Error ? e.message : failure)
    } finally { end() }
  }, [begin, end, show, load])

  const openPicker = useCallback(async (t: Transaction) => {
    begin()
    try {
      setPicker(await api.get<TransactionCandidates>(`/recurring-items/transaction-matches/${t.id}`))
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not look for recurring items this could be.')
    } finally { end() }
  }, [begin, end, show])

  const closePicker = useCallback(() => setPicker(null), [])

  const match = useCallback(
    (t: Transaction, o: OccurrenceRef) =>
      run(() => api.post(`${occurrenceUrl(o)}/matches`, { transactionId: t.id }), 'Could not record the match.'),
    [run],
  )

  return useMemo(() => ({
    byId,
    picker,
    openPicker,
    closePicker,
    confirm: (t, s) => match(t, s.occurrence),
    match,
    unmatch: (t, o) => run(() => api.del(`${occurrenceUrl(o)}/matches/${t.id}`), 'Could not unmatch that transaction.'),
    dismiss: (t, o) =>
      run(() => api.post(`${occurrenceUrl(o)}/dismissals`, { transactionId: t.id }), 'Could not dismiss the suggestion.'),
    undismiss: (t, o) => run(() => api.del(`${occurrenceUrl(o)}/dismissals/${t.id}`), 'Could not undo the dismissal.'),
  }), [byId, picker, openPicker, closePicker, match, run])
}
