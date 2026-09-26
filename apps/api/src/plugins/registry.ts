import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import type { Db } from '../db/client.js'
import { PluginService } from './service/PluginService.js'

/**
 * Registers bundled plugins on first boot.
 *
 * Idempotent: an existing row is left alone, so a user who disables a bundled
 * plugin does not have it silently re-enabled on the next restart. Version is
 * refreshed, since that follows the image rather than the user's choice.
 *
 * @param db - The database handle to register the plugins with.
 */
export async function seedBundledPlugins(db: Db): Promise<void> {
  await new PluginService(new KyselyUnitOfWork(db)).seedBundled()
}
