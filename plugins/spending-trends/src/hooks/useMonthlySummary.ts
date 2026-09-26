import { useEffect, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import type { SummaryResponse, SummaryState } from '../models/index.js'

/**
 * Loads the monthly spending aggregate.
 *
 * The plugin reaches core data only through `ctx.api`, which tags each request
 * with the plugin's identity so the server can check it against the manifest's
 * `requiredTables`. Asking for anything outside that grant is refused with a 403.
 *
 * Only the newest request may write to state: changing `months` or the client
 * aborts the one in flight, so a slow response for an earlier range cannot
 * overwrite a later one. The hook depends on the client and `months`, not on the
 * identity of the context object, so a host that rebuilds the context on every
 * render does not cause a refetch.
 *
 * @param ctx - The plugin context supplying the scoped API client.
 * @param months - How many months back to load. Defaults to 12.
 * @returns The rows, plus loading and error state.
 */
export function useMonthlySummary(ctx: PluginContext, months = 12): SummaryState {
  const { api } = ctx
  const [state, setState] = useState<SummaryState>({ rows: [], loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setState((previous) => (previous.loading ? previous : { ...previous, loading: true }))
    api
      .get<SummaryResponse>(`/core/transactions/monthly-summary?months=${months}`, { signal })
      .then((data) => {
        if (!signal.aborted) setState({ rows: data.rows, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (signal.aborted) return
        setState({
          rows: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load spending data.',
        })
      })
    return () => controller.abort()
  }, [api, months])

  return state
}
