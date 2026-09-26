import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerExportUserData } from './handlers/exportUserData.js'
import { registerGetSettingsConfig } from './handlers/getSettingsConfig.js'

/**
 * Registers the Settings endpoints under `/api/v1/settings`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerSettingsRoutes(app: FastifyInstance, { settings }: Services): void {
  registerGetSettingsConfig(app, settings)
  registerExportUserData(app, settings)
}
