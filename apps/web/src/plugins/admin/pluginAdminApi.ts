import { api } from '../../api/client.js'
import type { PluginEnabledChange, RegisteredPlugin } from '../../models/index.js'

/**
 * Lists every registered plugin, enabled or not. Owner only.
 *
 * @returns The plugins in id order.
 * @throws {ApiError} `403` with code `owner_required` for a member.
 */
export async function fetchRegisteredPlugins(): Promise<RegisteredPlugin[]> {
  return (await api.get<{ plugins: RegisteredPlugin[] }>('/plugins/registry')).plugins
}

/**
 * Switches a plugin on or off for the whole instance. Owner only.
 *
 * @param pluginId - The plugin's manifest id.
 * @param enabled - The new state.
 * @returns The plugin as it now is, with who changed it and when.
 * @throws {ApiError} `403` for a member, `404` for an unknown plugin.
 */
export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginEnabledChange> {
  return api.patch<PluginEnabledChange>(`/plugins/${encodeURIComponent(pluginId)}`, { enabled })
}
