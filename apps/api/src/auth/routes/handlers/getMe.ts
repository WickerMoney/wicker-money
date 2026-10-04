import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../../service.js'

/**
 * Registers `GET /api/v1/auth/me`: the signed-in user's identity.
 *
 * Responds `200` with `{ id, email, timezone, role }` and `401` if the request is
 * not authenticated. The time zone is read fresh, not taken from the token,
 * so a change made in another tab shows up here at once.
 *
 * @param app - The Fastify instance to register the route on.
 * @param auth - The service that reads the account.
 */
export function registerGetMe(app: FastifyInstance, auth: AuthService): void {
  app.get('/api/v1/auth/me', async (request) => {
    const user = await app.requireAuth(request)
    return auth.me(user.id)
  })
}
