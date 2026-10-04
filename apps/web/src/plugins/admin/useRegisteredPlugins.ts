import { useEffect, useState } from 'react'
import { fetchRegisteredPlugins } from './pluginAdminApi.js'
import type { RegisteredPluginsState } from './RegisteredPluginsState.js'

/**
 * Loads every registered plugin, for an owner.
 *
 * Only requested when `enabled`, which callers set from the signed-in user's
 * role, so a member's app never asks an endpoint it would be refused. The
 * server still refuses a member on its own; if the role the app holds is out
 * of date (an owner demoted mid-session), that refusal arrives as an error.
 *
 * @param enabled - Whether to request the listing at all.
 * @returns The listing state; `skipped` when not enabled.
 */
export function useRegisteredPlugins(enabled: boolean): RegisteredPluginsState {
  const [state, setState] = useState<RegisteredPluginsState>({ kind: 'loading' })

  useEffect(() => {
    if (!enabled) return
    let live = true
    fetchRegisteredPlugins()
      .then((plugins) => { if (live) setState({ kind: 'loaded', plugins }) })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load plugins.' })
      })
    return () => { live = false }
  }, [enabled])

  return enabled ? state : { kind: 'skipped' }
}
