import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../service.js'
import { registerChangePassword } from './handlers/changePassword.js'
import { registerGetMe } from './handlers/getMe.js'
import { registerLogin } from './handlers/login.js'
import { registerLogout } from './handlers/logout.js'
import { registerRefresh } from './handlers/refresh.js'
import { registerRegisterUser } from './handlers/registerUser.js'
import { registerUpdateMe } from './handlers/updateMe.js'
import { rateLimitedError } from './helpers/rateLimitedError.js'
import { requireSameOrigin } from './helpers/requireSameOrigin.js'

/**
 * Registers the authentication endpoints under `/api/v1/auth`.
 *
 * The endpoints live in their own encapsulated scope, which carries the rate
 * limiter (opt-in per route, keyed per client address; counters are in memory
 * and so per process) and rejects state-changing requests whose `Origin` names
 * another host.
 *
 * @param app - The Fastify instance to register routes on; needs `@fastify/cookie` registered.
 * @param auth - The service that creates accounts, verifies credentials and issues tokens.
 */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  void app.register(async (scope) => {
    await scope.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => rateLimitedError(),
    })
    scope.addHook('onRequest', requireSameOrigin)

    registerRegisterUser(scope, auth)
    registerLogin(scope, auth)
    registerRefresh(scope, auth)
    registerLogout(scope, auth)
    registerChangePassword(scope, auth)
    registerGetMe(scope, auth)
    registerUpdateMe(scope, auth)
  })
}
