import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginLoadFailure } from './PluginLoadFailure.js'

/** The result of loading plugins: those that registered and those that did not. */
export interface PluginRegistry {
  /** Manifests that registered successfully. */
  readonly plugins: readonly PluginManifest[]
  /** Plugins that failed, with reasons. */
  readonly failures: readonly PluginLoadFailure[]
}
