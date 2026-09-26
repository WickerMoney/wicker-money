import type { FastifyInstance } from 'fastify'
import type { SettingsService } from '../../service/SettingsService.js'

/**
 * Registers `GET /api/v1/settings/config`: non-sensitive, allow-listed
 * environment and instance state for the Config section of Settings.
 *
 * Authenticated like every other route; there is no separate operator tier, so
 * anyone who can sign in can see this. Responds `200` with a `ConfigInfo`.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The settings service.
 */
export function registerGetSettingsConfig(app: FastifyInstance, service: SettingsService): void {
  app.get('/api/v1/settings/config', async (request) => {
    await app.requireAuth(request)
    return service.getConfigInfo()
  })
}
