import { useContext } from 'react'
import { PluginRegistryCtx } from './registry/pluginRegistryContext.js'

/**
 * Whether a plugin ships with the app, for the component that mounts its frame. Outside a registry provider, with a
 * registry that carries no `bundled` map, or for a plugin the map does not mention, the answer is `false`: only an
 * explicit `true` from the API lets a frame save a file.
 *
 * @param pluginId - The manifest id.
 */
export function usePluginBundled(pluginId: string): boolean {
  const registry = useContext(PluginRegistryCtx)
  return registry?.bundled?.[pluginId] === true
}
