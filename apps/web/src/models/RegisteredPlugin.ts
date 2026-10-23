/**
 * One plugin as the owner-only registry listing reports it: enabled or not,
 * loadable or not. Mirrors the API's `GET /plugins/registry` rows.
 */
export interface RegisteredPlugin {
  /** The plugin's manifest id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-line description, or `null` when the plugin has no usable manifest. */
  readonly description: string | null
  /** Author, or `null` when the plugin has no usable manifest. */
  readonly author: string | null
  /** Version. */
  readonly version: string
  /** Whether it ships with Wicker Money. */
  readonly bundled: boolean
  /** Whether it is switched on for this instance. */
  readonly enabled: boolean
  /** `failed` means switched on but unable to load; see `failure`. */
  readonly status: 'enabled' | 'disabled' | 'failed'
  /** Why it cannot load, or `null` if it can. */
  readonly failure: string | null
  /** Where its remote entry loads from (an origin such as `https://plugins.example.com`), or `null` for this instance itself or when its manifest is unusable. */
  readonly origin: string | null
  /** The core tables its manifest lists, sorted; empty when its manifest is unusable. */
  readonly tables: readonly string[]
  /** What it adds to the app. */
  readonly contributes: {
    readonly pages: readonly string[]
    readonly widgets: readonly string[]
    readonly endpoints: boolean
  }
}
