import type { FastifyInstance } from 'fastify'

/**
 * Registers `GET /api/v1/auth/me`: the signed-in user's identity.
 *
 * Responds `200` with `{ id, email }` and `401` if the request is not
 * authenticated.
 *
 * @param app - The Fastify instance to register the route on.
 */
export function registerGetMe(app: FastifyInstance): void {
  app.get('/api/v1/auth/me', async (request) => {
    const user = await app.requireAuth(request)
    return { id: user.id, email: user.email }
  })
}
