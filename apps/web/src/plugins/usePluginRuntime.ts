import { useContext } from 'react'
import type { PluginRuntime } from './PluginRuntime.js'
import { PluginRegistryCtx } from './registry/pluginRegistryContext.js'

/**
 * Where a plugin's UI runs, for the component about to mount it.
 *
 * Outside a registry provider, or with a registry that carries no runtime map
 * (one built by hand in a test), plugins are `in-realm`, which is how every
 * plugin ran before isolation existed. Once the registry has a map, a plugin
 * the map does not mention is `isolated`: the sandbox is what an unknown
 * plugin gets.
 *
 * @param pluginId - The manifest id.
 */
export function usePluginRuntime(pluginId: string): PluginRuntime {
  const registry = useContext(PluginRegistryCtx)
  if (registry === null || registry.runtimes === undefined) return 'in-realm'
  return registry.runtimes[pluginId] ?? 'isolated'
}
