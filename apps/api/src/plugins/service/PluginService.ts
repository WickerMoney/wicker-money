import { checkRemoteEntry, parseManifest, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { BUNDLED_PLUGINS } from '../bundled.js'
import { DEFAULT_REGISTRY_TTL_MS } from './DEFAULT_REGISTRY_TTL_MS.js'
import type { LoadedPlugin } from './LoadedPlugin.js'
import type { PluginLoadFailure } from './PluginLoadFailure.js'
import type { PluginRegistrySnapshot } from './PluginRegistrySnapshot.js'
import type { PluginServiceOptions } from './PluginServiceOptions.js'

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

  /** Forgets the cached registry so the next read goes to the database. */
  clearCache(): void {
    this.generation += 1
    this.cached = undefined
    this.inflight = undefined
  }

  private async readRegistry(): Promise<PluginRegistrySnapshot> {
    const rows = await this.uow.forSystem(({ pluginRegistry }) => pluginRegistry.listEnabled(), { readOnly: true })

    const byId = new Map(this.bundled.map((m) => [m.id, m]))
    const plugins: LoadedPlugin[] = []
    const failures: PluginLoadFailure[] = []

    for (const row of rows) {
      const candidate = byId.get(row.plugin_id)
      if (candidate === undefined) {
        // Enabled in the database but absent from the image: a stale row.
        failures.push({ pluginId: row.plugin_id, reason: 'no manifest found for this plugin id' })
        continue
      }
      const { manifest, error } = parseManifest(candidate)
      if (manifest === undefined) {
        failures.push({ pluginId: row.plugin_id, reason: error ?? 'invalid manifest' })
        continue
      }
      const refusal = checkRemoteEntry(manifest.remoteEntry, this.remoteOrigins)
      if (refusal !== undefined) {
        failures.push({ pluginId: row.plugin_id, reason: refusal })
        continue
      }
      plugins.push({ manifest, bundled: row.bundled })
    }

    return { plugins, failures }
  }
}
