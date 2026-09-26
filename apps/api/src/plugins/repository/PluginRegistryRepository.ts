import type { EnabledPluginRow } from './EnabledPluginRow.js'

/** Persistence operations for the installed-plugin registry. The registry is instance-wide, not per user. */
export interface PluginRegistryRepository {
  /** @returns Every enabled plugin row, in no particular order. */
  listEnabled(): Promise<EnabledPluginRow[]>

  /**
   * Registers a bundled plugin, or refreshes its version if it is already registered.
   *
   * An existing row keeps its `enabled` flag, so a plugin the operator disabled
   * is not silently re-enabled on the next start.
   *
   * @param pluginId - The plugin's manifest id.
   * @param version - The version the image ships.
   */
  upsertBundled(pluginId: string, version: string): Promise<void>

  /**
   * Enables or disables a plugin.
   *
   * @param pluginId - The plugin's manifest id.
   * @param enabled - The new state.
   * @returns Whether a row with that id exists.
   */
  setEnabled(pluginId: string, enabled: boolean): Promise<boolean>
}
