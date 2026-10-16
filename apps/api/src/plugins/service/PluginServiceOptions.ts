import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { ExternalPlugin } from './ExternalPlugin.js'

/** Tunables and collaborators for {@link PluginService}; every field has a production default. */
export interface PluginServiceOptions {
  /** Manifests of the plugins that ship in the image. Defaults to the bundled set. */
  readonly bundled?: readonly PluginManifest[]
  /**
   * Third-party manifests the operator placed in `PLUGIN_MANIFEST_DIR`, read once at boot. Defaults to none.
   * They are registered switched off and held to the admission rules; see {@link PluginService.seedExternal}.
   */
  readonly external?: readonly ExternalPlugin[]
  /** `https` origins allowed to serve plugin front-end code, in addition to this host. Defaults to none. */
  readonly remoteOrigins?: readonly string[]
  /** How long a registry read is reused, in milliseconds. Defaults to 5000; `0` disables caching. */
  readonly cacheTtlMs?: number
  /** Clock in epoch milliseconds, replaceable in tests. */
  readonly now?: () => number
}
