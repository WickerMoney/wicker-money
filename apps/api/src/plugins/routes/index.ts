import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerListPlugins } from './handlers/listPlugins.js'
import { registerListRegisteredPlugins } from './handlers/listRegisteredPlugins.js'
import { registerSetPluginEnabled } from './handlers/setPluginEnabled.js'

/**
 * Registers the plugin endpoints under `/api/v1`: the list every signed-in
 * app loads, and the owner-only registry listing and enable/disable switch.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerPluginRoutes(app: FastifyInstance, { plugins }: Services): void {
  registerListPlugins(app, plugins)
  registerListRegisteredPlugins(app, plugins)
  registerSetPluginEnabled(app, plugins)
}
