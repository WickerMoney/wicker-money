import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginLoadFailure } from './PluginLoadFailure.js'
import type { PluginRuntime } from './PluginRuntime.js'

/** The result of loading plugins: those that registered and those that did not. */
export interface PluginRegistry {
  /** Manifests that registered successfully. */
  readonly plugins: readonly PluginManifest[]
  /** Plugins that failed, with reasons. */
  readonly failures: readonly PluginLoadFailure[]
  /**
   * Where each plugin's UI runs, by manifest id. A plugin missing from the map
   * is treated as `isolated` by the components that mount it, once a registry
   * has been loaded; code that builds a registry by hand (tests) may omit it.
   */
  readonly runtimes?: Readonly<Record<string, PluginRuntime>>
}
