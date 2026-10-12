import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import type { Db } from '../db/client.js'
import { PluginService } from './service/PluginService.js'
import type { PluginServiceOptions } from './service/PluginServiceOptions.js'

/**
 * Registers bundled plugins on first boot.
 *
 * Idempotent: an existing row is left alone, so a user who disables a bundled
 * plugin does not have it silently re-enabled on the next restart. Version is
 * refreshed, since that follows the image rather than the user's choice.
 *
 * The operator's third-party manifests (`options.external`) are registered here
 * too, but switched off, so nothing dropped in a directory runs until an owner
 * enables it.
 *
 * @param db - The database handle to register the plugins with.
 * @param options - Third-party manifests and, in tests, a replacement bundled set.
 */
export async function seedBundledPlugins(db: Db, options: Pick<PluginServiceOptions, 'bundled' | 'external'> = {}): Promise<void> {
  const service = new PluginService(new KyselyUnitOfWork(db), options)
  await service.seedBundled()
  await service.seedExternal()
}
