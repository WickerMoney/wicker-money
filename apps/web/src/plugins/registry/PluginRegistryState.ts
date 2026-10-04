import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginLoadFailure } from '../PluginLoadFailure.js'

/** The loaded plugin registry as the shell sees it, and a way to fetch it again. */
export interface PluginRegistryState {
  /** Manifests of the enabled plugins that registered. */
  readonly plugins: readonly PluginManifest[]
  /** Plugins the server or the host could not load. */
  readonly failures: readonly PluginLoadFailure[]
  /**
   * Fetches the registry again and applies it: newly enabled plugins mount,
   * disabled ones unmount. Never rejects; a failed fetch keeps what was there.
   */
  readonly refresh: () => Promise<void>
}
