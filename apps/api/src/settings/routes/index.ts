import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { rateLimitedError } from '../../auth/routes/helpers/rateLimitedError.js'
import type { Services } from '../../composition/Services.js'
import { registerEraseInstance } from './handlers/eraseInstance.js'
import { registerEraseMyData } from './handlers/eraseMyData.js'
import { registerExportUserData } from './handlers/exportUserData.js'
import { registerGetInstanceEraseCheck } from './handlers/getInstanceEraseCheck.js'
import { registerGetSettingsConfig } from './handlers/getSettingsConfig.js'
import { createEraseRateLimit } from './helpers/createEraseRateLimit.js'

/**
 * Registers the Settings endpoints under `/api/v1/settings`.
 *
 * The two erase actions live in their own encapsulated scope, which carries the
 * rate limiter they share (opt-in per route, counters in memory and so per
 * process, as for the auth endpoints).
 *
 * @param app - The Fastify instance to register routes on; needs `@fastify/cookie` registered.
 * @param services - The application services.
 */
export function registerSettingsRoutes(app: FastifyInstance, { settings, erase, auth }: Services): void {
  registerGetSettingsConfig(app, settings)
  registerExportUserData(app, settings)

  void app.register(async (scope) => {
    await scope.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => rateLimitedError(),
    })
    const limit = createEraseRateLimit(scope, auth.policy)

    registerEraseMyData(scope, erase, auth.policy, limit)
    registerGetInstanceEraseCheck(scope, erase)
    registerEraseInstance(scope, erase, auth.policy, limit)
  })
}
