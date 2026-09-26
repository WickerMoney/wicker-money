import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../../service.js'
import { clearRefreshCookie } from '../helpers/clearRefreshCookie.js'
import { REFRESH_COOKIE_NAME } from '../helpers/REFRESH_COOKIE_NAME.js'
import { requireCsrfHeader } from '../helpers/requireCsrfHeader.js'

/**
 * Registers `POST /api/v1/auth/logout`: ends the session the refresh cookie
 * belongs to and clears the cookie. Access tokens issued under that session
 * stop working immediately. Idempotent: a missing or unknown cookie still
 * yields `204`.
 *
 * Responds `204`, or `403` (`csrf_required`) without the anti-CSRF header.
 *
 * @param app - The Fastify instance to register the route on.
 * @param auth - The service that revokes the session.
 */
export function registerLogout(app: FastifyInstance, auth: AuthService): void {
  app.post('/api/v1/auth/logout', async (request, reply) => {
    requireCsrfHeader(request)
    const token = request.cookies[REFRESH_COOKIE_NAME]
    if (token !== undefined && token !== '') await auth.logout(token)
    clearRefreshCookie(reply, auth.policy)
    return reply.code(204).send()
  })
}
