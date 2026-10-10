import { useEffect, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import type { AccountListResponse, UpcomingResponse, UpcomingState } from '../models/index.js'

/**
 * Loads the upcoming outlook, with the account names its legs need.
 *
 * The outlook comes from `/core/recurring-items/upcoming` (the plugin's
 * `recurring_items` and `accounts` read grants). It is computed entirely on
 * the server, against the user's today in their time zone; the widget does no
 * date or money arithmetic of its own. Every leg carries its account's name,
 * so one request is enough. A host older than that sends legs without names:
 * only then, and only if a leg names an account the outlook does not list, is
 * `/core/accounts/list` fetched to fill them in.
 *
 * @param ctx - The plugin context; its `api` is scoped to the granted endpoints.
 * @returns The data, loading flag and error message.
 */
export function useUpcoming(ctx: PluginContext): UpcomingState {
  const { api } = ctx
  const [state, setState] = useState<UpcomingState>({
    data: null, accountNames: new Map(), loading: true, error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    ;(async () => {
      const data = await api.get<UpcomingResponse>('/core/recurring-items/upcoming', { signal })
      const names = new Map<string, string>()
      for (const a of data.accounts) names.set(a.accountId, a.name)
      const unnamed = new Set<string>()
      for (const o of data.occurrences) {
        for (const l of o.legs) {
          if (l.accountName !== undefined) names.set(l.accountId, l.accountName)
          else if (!names.has(l.accountId)) unnamed.add(l.accountId)
        }
      }
      if ([...unnamed].some((id) => !names.has(id))) {
        try {
          const list = await api.get<AccountListResponse>('/core/accounts/list', { signal })
          for (const a of list.accounts) if (!names.has(a.id)) names.set(a.id, a.name)
        } catch (err) {
          // The outlook is still worth showing; a leg falls back to "Unknown account".
          if (signal.aborted) throw err
        }
      }
      if (signal.aborted) return
      setState({ data, accountNames: names, loading: false, error: null })
    })().catch((err: unknown) => {
      if (signal.aborted) return
      setState({
        data: null, accountNames: new Map(), loading: false,
        error: err instanceof Error ? err.message : 'Could not load what is coming up.',
      })
    })
    return () => controller.abort()
  }, [api])

  return state
}
