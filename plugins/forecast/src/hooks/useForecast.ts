import { useEffect, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk/runtime'
import type { ForecastHorizon, ForecastResponse, ForecastState } from '../models/index.js'

/**
 * Loads the forecast for one account and horizon.
 *
 * Everything is computed on the server (`GET /core/recurring-items/forecast`,
 * granted by this plugin's `recurring_items` and `accounts` reads), against
 * the user's today in their time zone; the page does no date or money
 * arithmetic of its own beyond placing points on a chart.
 *
 * The previous answer stays in `data` while the next one loads, so switching
 * account or horizon swaps the chart rather than flashing a spinner.
 *
 * @param ctx - The plugin context.
 * @param accountId - The account, or `undefined` for the server's default.
 * @param horizon - How far ahead.
 * @returns The data, loading flag and error message.
 */
export function useForecast(ctx: PluginContext, accountId: string | undefined, horizon: ForecastHorizon): ForecastState {
  const { api } = ctx
  const [state, setState] = useState<ForecastState>({ data: null, loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setState((s) => ({ ...s, loading: true, error: null }))
    const query = new URLSearchParams({ horizon })
    if (accountId !== undefined) query.set('accountId', accountId)
    api.get<ForecastResponse>(`/core/recurring-items/forecast?${query.toString()}`, { signal })
      .then((data) => { if (!signal.aborted) setState({ data, loading: false, error: null }) })
      .catch((err: unknown) => {
        if (signal.aborted) return
        setState((s) => ({
          data: s.data, loading: false,
          error: err instanceof Error ? err.message : 'Could not load the forecast.',
        }))
      })
    return () => controller.abort()
  }, [api, accountId, horizon])

  return state
}
