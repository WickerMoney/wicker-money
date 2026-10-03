import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { MatchSuggestion, MatchSuggestionList } from '../../../models/index.js'

/** What {@link useSuggestions} returns. */
export interface Suggestions {
  readonly suggestions: readonly MatchSuggestion[]
  /** Records the suggested match. */
  readonly confirm: (suggestion: MatchSuggestion) => Promise<void>
  readonly reload: () => Promise<void>
}

/**
 * Loads the matches the server suggests (transactions that look like a
 * recent occurrence's payment) and confirms them one at a time. Nothing is
 * matched without a click.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param afterChange - Re-reads the page's data after a match.
 * @param showNotice - Shows a confirmation line.
 * @returns The suggestions and actions.
 */
export function useSuggestions(
  status: ActionStatus,
  afterChange: () => Promise<void>,
  showNotice: (message: string | null) => void,
): Suggestions {
  const [suggestions, setSuggestions] = useState<readonly MatchSuggestion[]>([])
  const latest = useLatestRequest()
  const { show } = status

  const reload = useCallback(
    () => latest.run(
      (signal) => api.get<MatchSuggestionList>('/recurring-items/suggestions', { signal }),
      (list) => setSuggestions(list.suggestions),
    ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load suggested matches.')),
    [latest, show],
  )

  useEffect(() => {
    void reload()
    return latest.cancel
  }, [reload, latest])

  const confirm = async (s: MatchSuggestion) => {
    status.begin()
    try {
      await api.post(
        `/recurring-items/${s.occurrence.itemId}/occurrences/${s.occurrence.nominalDate}/matches`,
        { transactionId: s.candidate.transactionId },
      )
      showNotice(`Matched '${s.candidate.merchant}' to ${s.occurrence.name}.`)
      await Promise.all([reload(), afterChange()])
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not record the match.')
    } finally { status.end() }
  }

  return { suggestions, confirm, reload }
}
