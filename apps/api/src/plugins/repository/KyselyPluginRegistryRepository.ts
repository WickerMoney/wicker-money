import type { Trx } from '../../db/Trx.js'
import type { EnabledPluginRow } from './EnabledPluginRow.js'
import type { PluginRegistryRepository } from './PluginRegistryRepository.js'
import type { RegisteredPluginRow } from './RegisteredPluginRow.js'

/** Kysely implementation of {@link PluginRegistryRepository} over a single transaction. */
export class KyselyPluginRegistryRepository implements PluginRegistryRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  listEnabled(): Promise<EnabledPluginRow[]> {
    return this.trx
      .selectFrom('core.plugins')
      .select(['plugin_id', 'bundled'])
      .where('enabled', '=', true)
      .execute()
  }

  /** @inheritdoc */
  listAll(): Promise<RegisteredPluginRow[]> {
    return this.trx
      .selectFrom('core.plugins')
      .select(['plugin_id', 'version', 'enabled', 'bundled'])
      .orderBy('plugin_id')
      .execute()
  }

  /** @inheritdoc */
  async upsertBundled(pluginId: string, version: string): Promise<void> {
    await this.trx
      .insertInto('core.plugins')
      .values({ plugin_id: pluginId, version, enabled: true, bundled: true, settings: {} })
      .onConflict((oc) => oc.column('plugin_id').doUpdateSet({ version }))
      .execute()
  }

  /** @inheritdoc */
  async upsertExternal(pluginId: string, version: string): Promise<void> {
    await this.trx
      .insertInto('core.plugins')
      .values({ plugin_id: pluginId, version, enabled: false, bundled: false, settings: {} })
      // `bundled` is corrected too: a row that said `true` for this id came from an image that shipped it, and this one does not.
      .onConflict((oc) => oc.column('plugin_id').doUpdateSet({ version, bundled: false }))
      .execute()
  }

  /** @inheritdoc */
  async setEnabled(pluginId: string, enabled: boolean): Promise<boolean> {
    const result = await this.trx
      .updateTable('core.plugins')
      .set({ enabled })
      .where('plugin_id', '=', pluginId)
      .executeTakeFirst()
    return result.numUpdatedRows > 0n
  }
}
