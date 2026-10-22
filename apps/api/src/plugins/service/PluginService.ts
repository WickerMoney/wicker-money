import { checkRemoteEntry, parseManifest, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { BUNDLED_PLUGINS } from '../bundled.js'
import { pinRefusal, serverCodeRefusal, type PluginSource } from './admission.js'
import { DEFAULT_REGISTRY_TTL_MS } from './DEFAULT_REGISTRY_TTL_MS.js'
import type { EnabledChange } from './EnabledChange.js'
import type { ExternalPlugin } from './ExternalPlugin.js'
import type { LoadedPlugin } from './LoadedPlugin.js'
import type { PluginLoadFailure } from './PluginLoadFailure.js'
import type { PluginRegistrySnapshot } from './PluginRegistrySnapshot.js'
import { refusedPermission } from './permissionPolicy.js'
import type { PluginServiceOptions } from './PluginServiceOptions.js'
import type { RegisteredPlugin } from './RegisteredPlugin.js'

/**
 * A manifest that passed every check, or the reason it did not. `source` is
 * where the manifest came from, found by looking it up here and never by
 * trusting the registry row's `bundled` column.
 */
type Checked =
  | { readonly manifest: PluginManifest; readonly source: PluginSource; readonly reason?: undefined }
  | { readonly manifest?: undefined; readonly source?: PluginSource; readonly reason: string }

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
  private readonly external: ReadonlyMap<string, ExternalPlugin>
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
    const external = new Map<string, ExternalPlugin>()
    for (const plugin of options.external ?? []) {
      const id = (plugin.manifest as { id?: unknown } | null)?.id
      // A bundled id is never taken over, and the first file to claim an id keeps it.
      if (typeof id === 'string' && !external.has(id) && !this.bundled.some((m) => m.id === id)) external.set(id, plugin)
    }
    this.external = external
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
   * Registers the operator's third-party plugins, switched off.
   *
   * A manifest in `PLUGIN_MANIFEST_DIR` is a request to be considered, not a
   * decision to run it: its row is created disabled, and an owner turns it on
   * from the plugin list, where its refusal reason (if it has one) is already
   * showing. An existing row keeps its enabled flag, so a restart never
   * re-enables a plugin an owner switched off, and never switches one on.
   *
   * Call it with {@link seedBundled}; they are separate because they differ in
   * the one thing that matters, whether the plugin starts out running.
   */
  async seedExternal(): Promise<void> {
    await this.uow.forSystem(async ({ pluginRegistry }) => {
      for (const [id, plugin] of this.external) {
        await pluginRegistry.upsertExternal(id, versionOf(plugin.manifest))
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
   * @param pluginId - A plugin manifest id.
   * @returns Whether a plugin with this id is registered, enabled or not. A plugin that is
   * registered but switched off, or whose manifest does not load, is registered; an id nobody
   * ever registered is not.
   */
  async isRegistered(pluginId: string): Promise<boolean> {
    const rows = await this.uow.forSystem(({ pluginRegistry }) => pluginRegistry.listAll(), { readOnly: true })
    return rows.some((row) => row.plugin_id === pluginId)
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
      const raw = this.candidate(row.plugin_id)?.manifest as { name?: unknown } | undefined
      const manifest = checked.manifest
      return {
        id: row.plugin_id,
        // An invalid manifest still usually carries a readable name.
        name: manifest?.name ?? (typeof raw?.name === 'string' ? raw.name : row.plugin_id),
        description: manifest?.description ?? null,
        author: manifest?.author ?? null,
        version: manifest?.version ?? row.version,
        bundled: checked.source === undefined ? row.bundled : checked.source === 'bundled',
        enabled: row.enabled,
        status: !row.enabled ? 'disabled' : manifest === undefined ? 'failed' : 'enabled',
        failure: checked.reason ?? null,
        origin: manifest === undefined ? null : originOf(manifest.remoteEntry),
        tables: manifest === undefined ? [] : [...new Set(manifest.requiredTables.map((t) => t.table))].sort(),
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
      const { manifest, source, reason } = this.check(row.plugin_id)
      if (manifest === undefined) failures.push({ pluginId: row.plugin_id, reason })
      // `bundled` is where the manifest was found, not what the row says: a row
      // is data in the database, and nothing in it may promote a plugin.
      else plugins.push({ manifest, bundled: source === 'bundled' })
    }

    return { plugins, failures }
  }

  /** The manifest the host knows for an id, and where it came from. Bundled wins; an external manifest never shadows one. */
  private candidate(pluginId: string): { readonly manifest: unknown; readonly source: PluginSource } | undefined {
    const bundled = this.bundled.find((m) => m.id === pluginId)
    if (bundled !== undefined) return { manifest: bundled, source: 'bundled' }
    const external = this.external.get(pluginId)
    return external === undefined ? undefined : { manifest: external.manifest, source: 'external' }
  }

  /**
   * Validates one plugin's manifest and applies the admission rules.
   *
   * Every manifest gets the same checks in the same order: its shape, the
   * permissions the host refuses, the rule that only a bundled plugin has a
   * server half, the origin its `remoteEntry` comes from, and the integrity
   * pin that a plugin the image did not ship (or any remote entry) needs.
   *
   * @param pluginId - The registered plugin id.
   * @returns The validated manifest and its source, or why it cannot be loaded.
   */
  private check(pluginId: string): Checked {
    const found = this.candidate(pluginId)
    // Registered in the database but absent from the image and from the manifest directory: a stale row.
    if (found === undefined) return { reason: 'no manifest found for this plugin id' }
    const { source } = found
    const { manifest, error } = parseManifest(found.manifest)
    if (manifest === undefined) return { source, reason: error ?? 'invalid manifest' }
    const refusal =
      refusedPermission(manifest.permissions) ??
      serverCodeRefusal(manifest, source) ??
      checkRemoteEntry(manifest.remoteEntry, this.remoteOrigins) ??
      pinRefusal(manifest, source)
    if (refusal !== undefined) return { source, reason: refusal }
    return { manifest, source }
  }
}

/**
 * The origin a remote entry loads from, for an owner deciding whether to trust it.
 *
 * @param remoteEntry - A validated manifest's `remoteEntry`.
 * @returns The origin of an absolute URL, or `null` for a path on this instance's own origin.
 */
function originOf(remoteEntry: string): string | null {
  if (remoteEntry.startsWith('/')) return null
  try { return new URL(remoteEntry).origin } catch { return null }
}

/** The version to register for a manifest that has not been validated: its own if it is a short string. */
function versionOf(manifest: unknown): string {
  const version = (manifest as { version?: unknown } | null)?.version
  return typeof version === 'string' && version !== '' && version.length <= 50 ? version : '0.0.0'
}
