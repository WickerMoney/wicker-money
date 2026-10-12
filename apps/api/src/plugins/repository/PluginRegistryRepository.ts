import type { EnabledPluginRow } from './EnabledPluginRow.js'
import type { RegisteredPluginRow } from './RegisteredPluginRow.js'

/** Persistence operations for the installed-plugin registry. The registry is instance-wide, not per user. */
export interface PluginRegistryRepository {
  /** @returns Every enabled plugin row, in no particular order. */
  listEnabled(): Promise<EnabledPluginRow[]>

  /** @returns Every registered plugin row, enabled or not, ordered by plugin id. */
  listAll(): Promise<RegisteredPluginRow[]>

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
   * Registers a third-party plugin switched off, or refreshes its version if it is already registered.
   *
   * An existing row keeps its `enabled` flag: a restart never switches a plugin
   * on that an owner left off, and never switches one off that an owner turned on.
   * A new row is disabled, so nothing the operator drops in a directory runs
   * until an owner says so.
   *
   * @param pluginId - The plugin's manifest id.
   * @param version - The version its manifest declares.
   */
  upsertExternal(pluginId: string, version: string): Promise<void>

  /**
   * Enables or disables a plugin.
   *
   * @param pluginId - The plugin's manifest id.
   * @param enabled - The new state.
   * @returns Whether a row with that id exists.
   */
  setEnabled(pluginId: string, enabled: boolean): Promise<boolean>
}
