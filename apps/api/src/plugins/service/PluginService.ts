import { checkRemoteEntry, parseManifest, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { BUNDLED_PLUGINS } from '../bundled.js'
import { DEFAULT_REGISTRY_TTL_MS } from './DEFAULT_REGISTRY_TTL_MS.js'
import type { EnabledChange } from './EnabledChange.js'
import type { LoadedPlugin } from './LoadedPlugin.js'
import type { PluginLoadFailure } from './PluginLoadFailure.js'
import type { PluginRegistrySnapshot } from './PluginRegistrySnapshot.js'
import type { PluginServiceOptions } from './PluginServiceOptions.js'
import type { RegisteredPlugin } from './RegisteredPlugin.js'

/** A manifest that passed every check, or the reason it did not. */
type Checked =
  | { readonly manifest: PluginManifest; readonly reason?: undefined }
  | { readonly manifest?: undefined; readonly reason: string }

/**
 * Plugin registry: which plugins are enabled and whether their manifests are
 * acceptable to this host.
 *
 * Every plugin request consults the registry, so reads are cached for a few
 * seconds. The cache is per process: a change made by another process (or by
 * hand in the database) becomes visible when the entry expires, and a change
 * made through this service is visible immediately.
 */
export class PluginService {
  private readonly bundled: readonly PluginManifest[]
  private readonly remoteOrigins: readonly string[]
  private readonly ttlMs: number
  private readonly now: () => number
  private cached: { readonly snapshot: PluginRegistrySnapshot; readonly expiresAt: number } | undefined
  private inflight: Promise<PluginRegistrySnapshot> | undefined
  private generation = 0

  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param options - Optional overrides; see {@link PluginServiceOptions}.
   */
  constructor(
    private readonly uow: UnitOfWork,
    options: PluginServiceOptions = {},
  ) {
    this.bundled = options.bundled ?? BUNDLED_PLUGINS
    this.remoteOrigins = options.remoteOrigins ?? []
    this.ttlMs = options.cacheTtlMs ?? DEFAULT_REGISTRY_TTL_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Registers the bundled plugins on first boot.
   *
   * Idempotent: an existing row keeps its enabled flag, so a plugin the user
   * disabled is not re-enabled by a restart. The version is refreshed, since
   * that follows the image rather than the user's choice.
   */
  async seedBundled(): Promise<void> {
    await this.uow.forSystem(async ({ pluginRegistry }) => {
      for (const manifest of this.bundled) {
        await pluginRegistry.upsertBundled(manifest.id, manifest.version)
      }
    })
    this.clearCache()
  }

  /**
   * The enabled plugins the frontend should load.
   *
   * Every manifest is validated even though bundled ones are written in this
   * repository: the same path will carry third-party manifests, and code that
   * trusts its input in development trusts it in production too. A manifest
   * that fails validation, or names a `remoteEntry` origin this host has not
   * allowed, disables that plugin alone and is reported; it never takes down
   * the registry.
   *
   * @returns The plugins that loaded and the ones that failed, each with a reason.
   */
  loadRegistry(): Promise<PluginRegistrySnapshot> {
    if (this.cached !== undefined && this.now() < this.cached.expiresAt) {
      return Promise.resolve(this.cached.snapshot)
    }
    if (this.inflight !== undefined) return this.inflight

    const generation = this.generation
    const load: Promise<PluginRegistrySnapshot> = this.readRegistry()
      .then((snapshot) => {
        // A clear that happened while the read was running means the read may
        // predate the change the clear was made for.
        if (generation === this.generation) {
          this.cached = { snapshot, expiresAt: this.now() + this.ttlMs }
        }
        return snapshot
      })
      .finally(() => {
        if (this.inflight === load) this.inflight = undefined
      })
    this.inflight = load
    return load
  }

  /**
   * @param pluginId - A plugin manifest id.
   * @returns The plugin if it is enabled and loaded, otherwise `undefined`.
   */
  async findEnabled(pluginId: string): Promise<LoadedPlugin | undefined> {
    const { plugins } = await this.loadRegistry()
    return plugins.find((p) => p.manifest.id === pluginId)
  }

  /**
   * Enables or disables a plugin and drops the cached registry, so the change
   * takes effect on the next request.
   *
   * @param pluginId - The plugin's manifest id.
   * @param enabled - The new state.
   * @returns Whether the plugin is registered.
   */
  async setEnabled(pluginId: string, enabled: boolean): Promise<boolean> {
    const found = await this.uow.forSystem(({ pluginRegistry }) => pluginRegistry.setEnabled(pluginId, enabled))
    this.clearCache()
    return found
  }

  /**
   * Every registered plugin, enabled or not, for an owner managing the instance.
   *
   * Not cached: it is read only from the plugin management page, and an owner
   * who has just toggled a plugin should see the database, not a cache.
   * Disabled plugins are validated too, so a manifest that would fail is
   * visible before anyone switches it on.
   *
   * @returns The plugins in id order.
   */
  async listRegistered(): Promise<RegisteredPlugin[]> {
    const rows = await this.uow.forSystem(({ pluginRegistry }) => pluginRegistry.listAll(), { readOnly: true })
    return rows.map((row) => {
      const checked = this.check(row.plugin_id)
      const raw = this.bundled.find((m) => m.id === row.plugin_id)
      const manifest = checked.manifest
      return {
        id: row.plugin_id,
        // An invalid manifest still usually carries a readable name.
        name: manifest?.name ?? raw?.name ?? row.plugin_id,
        description: manifest?.description ?? null,
        author: manifest?.author ?? null,
        version: manifest?.version ?? row.version,
        bundled: row.bundled,
        enabled: row.enabled,
        status: !row.enabled ? 'disabled' : manifest === undefined ? 'failed' : 'enabled',
        failure: checked.reason ?? null,
        contributes: {
          pages: manifest?.contributes.pages.map((p) => p.title) ?? [],
          widgets: manifest?.contributes.widgets.map((w) => w.title) ?? [],
          endpoints: manifest?.contributes.endpoints ?? false,
        },
      }
    })
  }

  /**
   * Switches a plugin on or off and reports the before and after, for an
   * owner's request and its audit log line.
   *
   * Disabling only flips the registry flag. The plugin's schema, rows and
   * database role are untouched, so switching it back on restores everything
   * it had.
   *
   * @param pluginId - The plugin's manifest id.
   * @param enabled - The new state.
   * @returns The previous state and the plugin as it now is, or `undefined`
   * if no plugin with that id is registered.
   */
  async changeEnabled(pluginId: string, enabled: boolean): Promise<EnabledChange | undefined> {
    const before = (await this.listRegistered()).find((p) => p.id === pluginId)
    if (before === undefined) return undefined
    if (!(await this.setEnabled(pluginId, enabled))) return undefined
    const after = (await this.listRegistered()).find((p) => p.id === pluginId)
    if (after === undefined) return undefined
    return { previous: before.enabled, plugin: after }
  }

  /** Forgets the cached registry so the next read goes to the database. */
  clearCache(): void {
    this.generation += 1
    this.cached = undefined
    this.inflight = undefined
  }

  private async readRegistry(): Promise<PluginRegistrySnapshot> {
    const rows = await this.uow.forSystem(({ pluginRegistry }) => pluginRegistry.listEnabled(), { readOnly: true })

    const plugins: LoadedPlugin[] = []
    const failures: PluginLoadFailure[] = []

    for (const row of rows) {
      const { manifest, reason } = this.check(row.plugin_id)
      if (manifest === undefined) failures.push({ pluginId: row.plugin_id, reason })
      else plugins.push({ manifest, bundled: row.bundled })
    }

    return { plugins, failures }
  }

  /**
   * Validates one plugin's manifest and remote entry origin.
   *
   * @param pluginId - The registered plugin id.
   * @returns The validated manifest, or why it cannot be loaded.
   */
  private check(pluginId: string): Checked {
    const candidate = this.bundled.find((m) => m.id === pluginId)
    // Registered in the database but absent from the image: a stale row.
    if (candidate === undefined) return { reason: 'no manifest found for this plugin id' }
    const { manifest, error } = parseManifest(candidate)
    if (manifest === undefined) return { reason: error ?? 'invalid manifest' }
    const refusal = checkRemoteEntry(manifest.remoteEntry, this.remoteOrigins)
    if (refusal !== undefined) return { reason: refusal }
    return { manifest }
  }
}
