/** An enabled plugin that could not be loaded, and why. */
export interface PluginLoadFailure {
  /** Id of the plugin that failed. */
  readonly pluginId: string
  /** Human-readable cause, such as a manifest validation message. */
  readonly reason: string
}
