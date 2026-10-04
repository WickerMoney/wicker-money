import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Spinner } from '@wickermoney/ui-kit'
import { loadPluginRegistry } from '../loader.js'
import type { PluginRegistry } from '../PluginRegistry.js'
import { PluginRegistryCtx } from './pluginRegistryContext.js'
import type { PluginRegistryState } from './PluginRegistryState.js'
import { reconcileRegistry } from './reconcileRegistry.js'
import { REGISTRY_REFETCH_MIN_INTERVAL_MS } from './REGISTRY_REFETCH_MIN_INTERVAL_MS.js'

/** Props for {@link PluginRegistryProvider}. */
export interface PluginRegistryProviderProps {
  /** The subtree that reads the registry. Rendered once the first load settles. */
  readonly children: ReactNode
  /** Fetches the registry. Replaceable in tests. */
  readonly load?: () => Promise<PluginRegistry>
  /** Minimum time between focus-triggered refetches, in milliseconds. */
  readonly minRefetchIntervalMs?: number
}

/**
 * Loads the plugin registry and keeps it current while the app is open.
 *
 * Everything plugin-shaped in the shell (routes, navigation, dashboard
 * widgets) is derived from this one list, so applying a new list is all it
 * takes to load or unload a plugin live: a plugin that drops out unmounts
 * everywhere at once, and one that appears mounts.
 *
 * The list is fetched again:
 *  - when `refresh` is called, as the plugin manager does after a toggle, so
 *    the person who flipped the switch sees it take effect immediately;
 *  - when the window regains focus or the tab becomes visible again, at most
 *    once per {@link REGISTRY_REFETCH_MIN_INTERVAL_MS}, so everyone else's open
 *    app picks up an owner's change the next time they come back to it.
 *
 * There is deliberately no polling interval. Plugins change rarely and only
 * by an owner's hand; a background tab nobody is looking at gains nothing
 * from a fresh list, and the focus refetch covers the tab someone returns to.
 * A plugin call made by a still-mounted widget in the meantime gets a clear
 * `plugin_disabled` / `grant_denied` error from the server, not stale data.
 *
 * A refetch that fails keeps the registry already on screen; only a failed
 * first load falls back to no plugins, so the core ledger still works.
 */
export function PluginRegistryProvider({
  children,
  load = loadPluginRegistry,
  minRefetchIntervalMs = REGISTRY_REFETCH_MIN_INTERVAL_MS,
}: PluginRegistryProviderProps) {
  const [registry, setRegistry] = useState<PluginRegistry | null>(null)
  const sequence = useRef(0)
  const lastFetchAt = useRef(0)
  const live = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const mine = ++sequence.current
    lastFetchAt.current = Date.now()
    try {
      const next = await load()
      // A later fetch (say, the one a toggle started) wins over an earlier one
      // that happened to resolve after it.
      if (live.current && mine === sequence.current) setRegistry((prev) => reconcileRegistry(prev, next))
    } catch {
      // The registry failing must not stop the core app: the ledger works
      // with no plugins at all, and that is the point of a thin core.
      if (live.current && mine === sequence.current) {
        setRegistry((prev) => prev ?? { plugins: [], failures: [{ pluginId: '*', reason: 'registry unavailable' }] })
      }
    }
  }, [load])

  useEffect(() => {
    live.current = true
    void refresh()
    return () => { live.current = false }
  }, [refresh])

  useEffect(() => {
    const onReturn = (): void => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastFetchAt.current < minRefetchIntervalMs) return
      void refresh()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh, minRefetchIntervalMs])

  const value = useMemo<PluginRegistryState | null>(
    () => (registry === null ? null : { plugins: registry.plugins, failures: registry.failures, refresh }),
    [registry, refresh],
  )

  if (value === null) return <div className="boot"><Spinner label="Loading plugins" /></div>
  return <PluginRegistryCtx.Provider value={value}>{children}</PluginRegistryCtx.Provider>
}
