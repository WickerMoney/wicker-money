/** A plugin that could not be loaded, and why. One failure never affects the others. */
export interface PluginLoadFailure {
  /** Id of the plugin that failed, or `unknown` when it could not be read. */
  readonly pluginId: string
  /** Why it failed. */
  readonly reason: string
}
