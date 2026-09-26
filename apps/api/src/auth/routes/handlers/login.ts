import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AuthService } from '../../service.js'
import { addressRateLimit } from '../helpers/addressRateLimit.js'
import { createEmailRateLimit } from '../helpers/createEmailRateLimit.js'
import { setRefreshCookie } from '../helpers/setRefreshCookie.js'
import { toAuthResponse } from '../helpers/toAuthResponse.js'
import { credentials } from '../schemas/credentials.js'

/**
 * Registers `POST /api/v1/auth/login`: signs a user in with email and password.
 *
 * Responds `200` with the access token and user and sets the refresh cookie,
 * `400` if the body fails validation, `401` if the email or password is
 * incorrect, and `429` (`rate_limited`) past the per-address or per-email limit.
 *
 * @param app - The Fastify instance to register the route on; must have `@fastify/rate-limit` registered.
 * @param auth - The service that verifies credentials and issues tokens.
 */
export function registerLogin(app: FastifyInstance, auth: AuthService): void {
  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: addressRateLimit(auth.policy) },
      preHandler: createEmailRateLimit(app, auth.policy, 'login'),
    },
    async (request, reply) => {
      const { email, password } = parseBody(credentials, request.body)
      const session = await auth.login(email, password)
      setRefreshCookie(reply, auth.policy, session.refreshToken)
      return reply.send(toAuthResponse(session))
    },
  )
}
