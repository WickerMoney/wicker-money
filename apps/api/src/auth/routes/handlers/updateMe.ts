import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { AuthService } from '../../service.js'
import { updateMeBody } from '../schemas/updateMeBody.js'

/**
 * Registers `PATCH /api/v1/auth/me`: updates the signed-in user's profile.
 * Only `timezone` can change: an IANA name, matched case-insensitively and
 * stored in its canonical spelling.
 *
 * Responds `200` with `{ id, email, timezone }`, `400` if the body fails
 * validation or names an unknown zone, and `401` if the request is not
 * authenticated.
 *
 * @param app - The Fastify instance to register the route on.
 * @param auth - The service that updates the account.
 */
export function registerUpdateMe(app: FastifyInstance, auth: AuthService): void {
  app.patch('/api/v1/auth/me', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(updateMeBody, request.body)
    return auth.setTimezone(user.id, body.timezone)
  })
}
