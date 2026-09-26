import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AuthService } from '../../service.js'
import { clearRefreshCookie } from '../helpers/clearRefreshCookie.js'
import { changePasswordBody } from '../schemas/changePasswordBody.js'

/**
 * Registers `POST /api/v1/auth/change-password`: replaces the signed-in user's
 * password and ends all of their sessions, this one included, so the refresh
 * cookie is cleared and the client must sign in again.
 *
 * Responds `204` on success, `400` if the body fails validation, and `401` if
 * the request is not authenticated or the current password is incorrect.
 *
 * @param app - The Fastify instance to register the route on.
 * @param auth - The service that verifies and replaces the password.
 */
export function registerChangePassword(app: FastifyInstance, auth: AuthService): void {
  app.post('/api/v1/auth/change-password', async (request, reply) => {
    const user = await app.requireAuth(request)
    const body = parseBody(changePasswordBody, request.body)
    await auth.changePassword(user.id, body.currentPassword, body.newPassword)
    clearRefreshCookie(reply, auth.policy)
    return reply.code(204).send()
  })
}
