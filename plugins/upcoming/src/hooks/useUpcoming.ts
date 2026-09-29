import { useEffect, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import type { AccountListResponse, UpcomingResponse, UpcomingState } from '../models/index.js'

/**
 * Loads the upcoming outlook and the account names it needs.
 *
 * Both come from core endpoints this plugin's manifest is granted
 * (`recurring_items` and `accounts`, read). The outlook is computed entirely
 * on the server, against the user's today in their time zone; the widget
 * does no date or money arithmetic of its own.
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
    Promise.all([
      api.get<UpcomingResponse>('/core/recurring-items/upcoming', { signal }),
      api.get<AccountListResponse>('/core/accounts/list', { signal }),
    ])
      .then(([data, accounts]) => {
        if (signal.aborted) return
        // Names for the checking accounts come with the outlook even if one is
        // archived; the list fills in everything else a leg can name.
        const names = new Map(accounts.accounts.map((a) => [a.id, a.name]))
        for (const a of data.accounts) names.set(a.accountId, a.name)
        setState({ data, accountNames: names, loading: false, error: null })
      })
      .catch((err: unknown) => {
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
