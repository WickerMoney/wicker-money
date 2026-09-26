import type { PluginManifest } from '@wickermoney/plugin-sdk'

/** A plugin that is enabled and whose manifest validated. */
export interface LoadedPlugin {
  /** The validated manifest. */
  readonly manifest: PluginManifest
  /** Whether the plugin ships in the application image rather than being third-party. */
  readonly bundled: boolean
}
