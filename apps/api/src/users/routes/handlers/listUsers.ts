import type { FastifyInstance } from 'fastify'
import type { UserAdminService } from '../../service/UserAdminService.js'

/**
 * Registers `GET /api/v1/users`: every account on the instance, for an owner
 * choosing who else administers it.
 *
 * Owner only. Responds `200` with `{ users: [{ id, email, role, createdAt }] }`,
 * oldest first, `401` without a session and `403` (`owner_required`) for a
 * member. Nothing else about an account is returned: no password digest, no
 * time zone, and none of its ledger.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The account administration service.
 */
export function registerListUsers(app: FastifyInstance, service: UserAdminService): void {
  app.get('/api/v1/users', async (request) => {
    const caller = await app.requireOwner(request)
    const users = await service.list(caller.id)
    return {
      users: users.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt.toISOString() })),
    }
  })
}
