/** An enabled row of the plugin registry table. */
export interface EnabledPluginRow {
  /** The plugin's manifest id. */
  readonly plugin_id: string
  /** Whether the plugin ships in the application image. */
  readonly bundled: boolean
}
