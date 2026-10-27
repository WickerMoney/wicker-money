import { useToast } from '@wickermoney/ui-kit'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { DismissedSuggestion, MatchSuggestion, MatchSuggestionList } from '../../../models/index.js'

/** What {@link useSuggestions} returns. */
export interface Suggestions {
  readonly suggestions: readonly MatchSuggestion[]
  /** Suggestions the user dismissed, recent enough to undo. */
  readonly dismissed: readonly DismissedSuggestion[]
  /** Records the suggested match. */
  readonly confirm: (suggestion: MatchSuggestion) => Promise<void>
  /** Says the transaction is not this occurrence, so the pair is not suggested again. */
  readonly dismiss: (suggestion: MatchSuggestion) => Promise<void>
  /** Undoes a dismissal, so the pair can be suggested again. */
  readonly undismiss: (dismissed: DismissedSuggestion) => Promise<void>
  readonly reload: () => Promise<void>
}

/** Match, Not this and Undo share one toast key with the occurrence panel's matching (ADR 0009). */
const TOAST_KEY = 'recurring:match'

/** The URL of one occurrence. */
const occurrenceUrl = (o: { itemId: string; nominalDate: string }) => `/recurring-items/${o.itemId}/occurrences/${o.nominalDate}`

/**
 * Loads the matches the server suggests (transactions that look like a
 * recent occurrence's payment) and confirms or dismisses them one at a time.
 * Nothing is matched without a click.
 *
 * @param status - Busy flag shared with the page; also receives the message when the load fails.
 * @param afterChange - Re-reads the page's data after a match.
 * @returns The suggestions and actions.
 */
export function useSuggestions(
  status: ActionStatus,
  afterChange: () => Promise<void>,
): Suggestions {
  const [suggestions, setSuggestions] = useState<readonly MatchSuggestion[]>([])
  const [dismissed, setDismissed] = useState<readonly DismissedSuggestion[]>([])
  const latest = useLatestRequest()
  const { show } = status
  const toast = useToast().show

  const reload = useCallback(
    () => latest.run(
      (signal) => api.get<MatchSuggestionList>('/recurring-items/suggestions', { signal }),
      (list) => { setSuggestions(list.suggestions); setDismissed(list.dismissed ?? []) },
    ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load suggested matches.')),
    [latest, show],
  )

  useEffect(() => {
    void reload()
    return latest.cancel
  }, [reload, latest])

  const run = async (work: () => Promise<unknown>, notice: string, failure: string, everything: boolean) => {
    status.begin()
    try {
      await work()
      toast(notice, { kind: 'success', key: TOAST_KEY })
      // A dismissal changes only the suggestions; a match changes the items too.
      await (everything ? Promise.all([reload(), afterChange()]) : reload())
    } catch (e) {
      toast(e instanceof Error ? e.message : failure, { kind: 'error', key: TOAST_KEY })
    } finally { status.end() }
  }

  const confirm = (s: MatchSuggestion) => run(
    () => api.post(`${occurrenceUrl(s.occurrence)}/matches`, { transactionId: s.candidate.transactionId }),
    `Matched '${s.candidate.merchant}' to ${s.occurrence.name}.`,
    'Could not record the match.',
    true,
  )

  const dismiss = (s: MatchSuggestion) => run(
    () => api.post(`${occurrenceUrl(s.occurrence)}/dismissals`, { transactionId: s.candidate.transactionId }),
    `'${s.candidate.merchant}' will not be suggested for ${s.occurrence.name} again.`,
    'Could not dismiss the suggestion.',
    false,
  )

  const undismiss = (d: DismissedSuggestion) => run(
    () => api.del(`${occurrenceUrl(d.occurrence)}/dismissals/${d.transaction.id}`),
    `'${d.transaction.merchant}' can be suggested for ${d.occurrence.name} again.`,
    'Could not undo the dismissal.',
    false,
  )

  return { suggestions, dismissed, confirm, dismiss, undismiss, reload }
}
