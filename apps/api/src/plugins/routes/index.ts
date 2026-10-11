import type { FastifyInstance } from 'fastify'
import type { Config } from '../../config.js'
import type { Services } from '../../composition/Services.js'
import { registerListPlugins } from './handlers/listPlugins.js'
import { registerMintPluginToken } from './handlers/mintPluginToken.js'
import { registerListRegisteredPlugins } from './handlers/listRegisteredPlugins.js'
import { registerSetPluginEnabled } from './handlers/setPluginEnabled.js'

/**
 * Registers the plugin endpoints under `/api/v1`: the list every signed-in
 * app loads, the owner-only registry listing and enable/disable switch, and
 * the route that mints a plugin its short-lived token.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 * @param config - Configuration providing the token signing settings.
 */
export function registerPluginRoutes(app: FastifyInstance, { plugins }: Services, config: Config): void {
  registerListPlugins(app, plugins)
  registerListRegisteredPlugins(app, plugins)
  registerSetPluginEnabled(app, plugins)
  registerMintPluginToken(app, plugins, config)
}
