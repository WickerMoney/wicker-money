import { addDays } from '@wickermoney/plugin-sdk/date'
import { useToast } from '@wickermoney/ui-kit'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import { formatDate } from '../../../lib/formatDate.js'
import type {
  OccurrenceCandidates, RecurringItem, RecurringOccurrence, RecurringOccurrenceList,
} from '../../../models/index.js'

/** Days of history the panel shows before today. */
export const HISTORY_DAYS = 45
/** Days ahead the panel shows. */
export const AHEAD_DAYS = 60

/** Matching shares a toast key with the suggestions panel; skip and change share their own (ADR 0009). */
const MATCH_KEY = 'recurring:match'
const OCCURRENCE_KEY = 'recurring:occurrence'

/** What {@link useOccurrences} returns. */
export interface Occurrences {
  /** `null` until loaded. */
  readonly list: readonly RecurringOccurrence[] | null
  /** The occurrence whose candidates are open, with them; `null` when none is. */
  readonly candidates: OccurrenceCandidates | null
  readonly findMatches: (occurrence: RecurringOccurrence) => Promise<void>
  readonly closeMatches: () => void
  readonly match: (occurrence: RecurringOccurrence, transactionId: string) => Promise<void>
  readonly unmatch: (occurrence: RecurringOccurrence, transactionId: string) => Promise<void>
  /**
   * Replaces what is recorded about one occurrence (skip, move, amounts).
   * A failure goes to `onError` when given (a form showing it by its
   * fields), otherwise it is an error toast.
   */
  readonly record: (
    occurrence: RecurringOccurrence,
    body: { skipped?: boolean; expectedDate?: string | null; legs?: { accountId: string; amount: string }[] | null },
    onError?: (error: unknown) => void,
  ) => Promise<boolean>
}

/**
 * One item's recent and coming occurrences, and the actions on them:
 * skip, move, change the amount, and match or unmatch transactions. What each
 * did is said in a toast.
 *
 * @param item - The item.
 * @param today - The server's today.
 * @param status - Busy flag shared with the page; also receives the message when the load fails.
 * @param afterChange - Re-reads the page's data after a change (next due, late flags, suggestions).
 * @returns The occurrences and actions.
 */
export function useOccurrences(
  item: RecurringItem,
  today: string,
  status: ActionStatus,
  afterChange: () => Promise<void>,
): Occurrences {
  const [list, setList] = useState<readonly RecurringOccurrence[] | null>(null)
  const [candidates, setCandidates] = useState<OccurrenceCandidates | null>(null)
  const latest = useLatestRequest()
  const { show } = status
  const toast = useToast().show

  const reload = useCallback(
    () => latest.run(
      (signal) => api.get<RecurringOccurrenceList>(
        `/recurring-items/occurrences?itemId=${item.id}&from=${addDays(today, -HISTORY_DAYS)}&to=${addDays(today, AHEAD_DAYS)}`,
        { signal },
      ),
      (r) => setList(r.occurrences),
    ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load this item’s occurrences.')),
    [item.id, today, latest, show],
  )

  useEffect(() => {
    setList(null)
    setCandidates(null)
    void reload()
    return latest.cancel
  }, [reload, latest])

  const url = (o: RecurringOccurrence) => `/recurring-items/${o.itemId}/occurrences/${o.nominalDate}`

  const run = async (
    work: () => Promise<void>, done: string, key: string, onError?: (error: unknown) => void,
  ): Promise<boolean> => {
    status.begin()
    try {
      await work()
      toast(done, { kind: 'success', key })
      await Promise.all([reload(), afterChange()])
      return true
    } catch (e) {
      if (onError !== undefined) onError(e)
      else toast(e instanceof Error ? e.message : 'Could not save the change.', { kind: 'error', key })
      return false
    } finally { status.end() }
  }

  const findMatches = async (o: RecurringOccurrence) => {
    status.begin()
    try {
      setCandidates(await api.get<OccurrenceCandidates>(`${url(o)}/candidates`))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not look for matching transactions.', { kind: 'error', key: MATCH_KEY })
    } finally { status.end() }
  }

  return {
    list,
    candidates,
    findMatches,
    closeMatches: () => setCandidates(null),
    match: async (o, transactionId) => {
      const merchant = candidates?.legs.flatMap((l) => l.candidates).find((c) => c.transactionId === transactionId)?.merchant
      const done = `Matched ${merchant === undefined ? 'a transaction' : `'${merchant}'`} to ${item.name} (${formatDate(o.expectedDate)}).`
      if (await run(() => api.post(`${url(o)}/matches`, { transactionId }), done, MATCH_KEY)) setCandidates(null)
    },
    unmatch: async (o, transactionId) => {
      const merchant = o.legs.find((l) => l.transaction?.id === transactionId)?.transaction?.merchant
      await run(
        () => api.del(`${url(o)}/matches/${transactionId}`),
        `Unmatched ${merchant === undefined ? 'a transaction' : `'${merchant}'`} from ${item.name} (${formatDate(o.expectedDate)}).`,
        MATCH_KEY,
      )
    },
    record: (o, body, onError) => {
      const when = `${item.name} (${formatDate(o.expectedDate)})`
      const done = body.skipped === true ? `Skipped ${when}.` : body.skipped === false ? `Un-skipped ${when}.` : `Changed ${when}.`
      return run(() => api.put(url(o), body), done, OCCURRENCE_KEY, onError)
    },
  }
}
