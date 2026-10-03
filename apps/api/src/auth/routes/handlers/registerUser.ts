import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AuthService } from '../../service.js'
import { addressRateLimit } from '../helpers/addressRateLimit.js'
import { createEmailRateLimit } from '../helpers/createEmailRateLimit.js'
import { setRefreshCookie } from '../helpers/setRefreshCookie.js'
import { toAuthResponse } from '../helpers/toAuthResponse.js'
import { registerBody } from '../schemas/registerBody.js'

/**
 * Registers `POST /api/v1/auth/register`: creates an account and signs it in.
 *
 * The body may carry the browser's `timezone`; a recognised IANA zone becomes
 * the account's, anything else leaves the `UTC` default.
 *
 * Responds `201` with the access token and user and sets the refresh cookie,
 * `400` if the body fails validation, `403` (`registration_disabled`) if the
 * server does not accept new accounts, `409` (`email_taken`) if the email is
 * already registered, and `429` (`rate_limited`) past the per-address or
 * per-email limit.
 *
 * @param app - The Fastify instance to register the route on; must have `@fastify/rate-limit` registered.
 * @param auth - The service that creates accounts and issues tokens.
 */
export function registerRegisterUser(app: FastifyInstance, auth: AuthService): void {
  app.post(
    '/api/v1/auth/register',
    {
      config: { rateLimit: addressRateLimit(auth.policy) },
      preHandler: createEmailRateLimit(app, auth.policy, 'register'),
    },
    async (request, reply) => {
      const { email, password, timezone } = parseBody(registerBody, request.body)
      const session = await auth.register(email, password, timezone)
      setRefreshCookie(reply, auth.policy, session.refreshToken)
      return reply.code(201).send(toAuthResponse(session))
    },
  )
}
