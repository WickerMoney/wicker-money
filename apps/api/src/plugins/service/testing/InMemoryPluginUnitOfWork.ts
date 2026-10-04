import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { EnabledPluginRow } from '../../repository/EnabledPluginRow.js'
import type { PluginRegistryRepository } from '../../repository/PluginRegistryRepository.js'

/** One registry row held by the fake. */
interface FakePluginRow {
  pluginId: string
  version: string
  enabled: boolean
  bundled: boolean
}

/**
 * A {@link UnitOfWork} over an in-memory plugin registry.
 *
 * Counts reads so a test can tell a cached lookup from one that reached the
 * "database". Only `pluginRegistry` exists; touching any other repository fails
 * the test loudly.
 */
export class InMemoryPluginUnitOfWork implements UnitOfWork {
  /** The registry rows, mutable by tests to simulate an out-of-band change. */
  readonly rows: FakePluginRow[] = []

  /** How many times the enabled plugins were listed. */
  listCalls = 0

  private readonly registry: PluginRegistryRepository = {
    listEnabled: async (): Promise<EnabledPluginRow[]> => {
      this.listCalls += 1
      return this.rows.filter((r) => r.enabled).map((r) => ({ plugin_id: r.pluginId, bundled: r.bundled }))
    },
    listAll: async () =>
      [...this.rows]
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
        .map((r) => ({ plugin_id: r.pluginId, version: r.version, enabled: r.enabled, bundled: r.bundled })),
    upsertBundled: async (pluginId, version): Promise<void> => {
      const existing = this.rows.find((r) => r.pluginId === pluginId)
      if (existing === undefined) this.rows.push({ pluginId, version, enabled: true, bundled: true })
      else existing.version = version
    },
    setEnabled: async (pluginId, enabled): Promise<boolean> => {
      const existing = this.rows.find((r) => r.pluginId === pluginId)
      if (existing === undefined) return false
      existing.enabled = enabled
      return true
    },
  }

  /** @inheritdoc */
  forUser<T>(_userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work({ pluginRegistry: this.registry } as Partial<Repositories> as Repositories)
  }

  /** @inheritdoc */
  forSystem<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.forUser('system', work)
  }
}
