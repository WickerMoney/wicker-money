/** Whether a registered plugin is running, switched off, or switched on but unable to load. */
export type RegisteredPluginStatus = 'enabled' | 'disabled' | 'failed'

/**
 * One plugin in the registry as an owner managing the instance sees it:
 * enabled or not, loadable or not.
 */
export interface RegisteredPlugin {
  /** The plugin's manifest id. */
  readonly id: string
  /** Display name from the manifest, or the id when no usable manifest exists. */
  readonly name: string
  /** One-line description from the manifest, or `null` when no usable manifest exists. */
  readonly description: string | null
  /** Author from the manifest, or `null` when no usable manifest exists. */
  readonly author: string | null
  /** The manifest's version, or the registered version when no manifest exists. */
  readonly version: string
  /** Whether the plugin ships in the application image. */
  readonly bundled: boolean
  /** Whether the plugin is switched on for this instance. */
  readonly enabled: boolean
  /** `failed` means switched on but not loaded; see {@link failure}. */
  readonly status: RegisteredPluginStatus
  /**
   * Why the plugin cannot load, or `null` if it can. Reported for a disabled
   * plugin too, so an owner knows before switching it on that it will fail.
   */
  readonly failure: string | null
  /**
   * The origin its remote entry loads from, such as `https://plugins.example.com`.
   * `null` when it loads from this instance's own origin, or when no usable
   * manifest exists to say.
   */
  readonly origin: string | null
  /**
   * The core tables its manifest lists, sorted, once. The token a plugin in a
   * sandboxed frame receives reaches only read-only aggregates for these.
   * Empty when no usable manifest exists.
   */
  readonly tables: readonly string[]
  /** What the plugin adds to the app, by title, so an owner can tell what switching it off removes. */
  readonly contributes: {
    /** Titles of the pages it adds. */
    readonly pages: readonly string[]
    /** Titles of the dashboard widgets it adds. */
    readonly widgets: readonly string[]
    /** Whether it has a server half with its own API routes. */
    readonly endpoints: boolean
  }
}
