/** One row of the plugin registry table, enabled or not. */
export interface RegisteredPluginRow {
  /** The plugin's manifest id. */
  readonly plugin_id: string
  /** The version last registered, which follows the image for bundled plugins. */
  readonly version: string
  /** Whether the plugin is switched on for this instance. */
  readonly enabled: boolean
  /** Whether the plugin ships in the application image. */
  readonly bundled: boolean
}
