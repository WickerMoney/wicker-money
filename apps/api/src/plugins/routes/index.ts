import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerListPlugins } from './handlers/listPlugins.js'

/**
 * Registers the plugin listing endpoint under `/api/v1`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerPluginRoutes(app: FastifyInstance, { plugins }: Services): void {
  registerListPlugins(app, plugins)
}
