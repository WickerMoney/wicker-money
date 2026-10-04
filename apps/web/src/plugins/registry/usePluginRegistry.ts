import { useContext } from 'react'
import { PluginRegistryCtx } from './pluginRegistryContext.js'
import type { PluginRegistryState } from './PluginRegistryState.js'

/**
 * Reads the loaded plugin registry.
 *
 * @returns The registry and its `refresh`.
 * @throws {Error} If rendered outside a loaded `PluginRegistryProvider`.
 */
export function usePluginRegistry(): PluginRegistryState {
  const value = useContext(PluginRegistryCtx)
  if (value === null) throw new Error('usePluginRegistry must be used inside a PluginRegistryProvider.')
  return value
}
