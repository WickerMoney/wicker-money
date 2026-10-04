import type { FastifyInstance } from 'fastify'
import type { PluginService } from '../../service/PluginService.js'

/**
 * Registers `GET /api/v1/plugins/registry`: every registered plugin, enabled
 * or not, for an owner managing the instance.
 *
 * Owner only. `GET /api/v1/plugins` stays the list every signed-in user's
 * app loads; this one adds what only the person deciding needs: disabled
 * plugins, and why a plugin cannot load even while it is switched off.
 * Responds `200` with `{ plugins }` (see `RegisteredPlugin`), `401` without a
 * session and `403` (`owner_required`) for a member.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The plugin registry service.
 */
export function registerListRegisteredPlugins(app: FastifyInstance, service: PluginService): void {
  app.get('/api/v1/plugins/registry', async (request) => {
    await app.requireOwner(request)
    return { plugins: await service.listRegistered() }
  })
}
