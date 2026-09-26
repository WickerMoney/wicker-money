import type { LoadedPlugin } from './LoadedPlugin.js'
import type { PluginLoadFailure } from './PluginLoadFailure.js'

/** The result of one registry load. */
export interface PluginRegistrySnapshot {
  /** Enabled plugins with valid manifests. */
  readonly plugins: readonly LoadedPlugin[]
  /** Enabled plugins that could not be loaded. */
  readonly failures: readonly PluginLoadFailure[]
}
