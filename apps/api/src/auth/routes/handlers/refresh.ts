import type { FastifyInstance } from 'fastify'
import { UnauthorizedError } from '../../../errors.js'
import type { AuthService } from '../../service.js'
import { addressRateLimit } from '../helpers/addressRateLimit.js'
import { clearRefreshCookie } from '../helpers/clearRefreshCookie.js'
import { REFRESH_COOKIE_NAME } from '../helpers/REFRESH_COOKIE_NAME.js'
import { requireCsrfHeader } from '../helpers/requireCsrfHeader.js'
import { setRefreshCookie } from '../helpers/setRefreshCookie.js'
import { toAuthResponse } from '../helpers/toAuthResponse.js'

/**
 * Registers `POST /api/v1/auth/refresh`: exchanges the refresh cookie for a new
 * access token and a rotated cookie. Takes no body.
 *
 * Responds `200` with the access token and user and sets the new cookie,
 * `403` (`csrf_required`) without the anti-CSRF header, `401` with the cookie
 * cleared if it is missing, invalid, expired or already used, and `429`
 * (`rate_limited`) past the per-address limit.
 *
 * @param app - The Fastify instance to register the route on; must have `@fastify/rate-limit` registered.
 * @param auth - The service that rotates refresh tokens.
 */
export function registerRefresh(app: FastifyInstance, auth: AuthService): void {
  app.post(
    '/api/v1/auth/refresh',
    { config: { rateLimit: addressRateLimit(auth.policy) } },
    async (request, reply) => {
      requireCsrfHeader(request)
      try {
        const token = request.cookies[REFRESH_COOKIE_NAME]
        if (token === undefined || token === '') {
          throw new UnauthorizedError('Refresh token is missing.')
        }
        const session = await auth.refresh(token)
        setRefreshCookie(reply, auth.policy, session.refreshToken)
        return reply.send(toAuthResponse(session))
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error
        // Sent here rather than thrown so the deletion header reaches the client.
        clearRefreshCookie(reply, auth.policy)
        return reply.code(401).send({ code: error.code, message: error.message })
      }
    },
  )
}
