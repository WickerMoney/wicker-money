import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { UserAdminService } from '../../service/UserAdminService.js'
import { setUserRoleBody } from '../schemas/setUserRoleBody.js'

/**
 * Registers `PATCH /api/v1/users/:id/role`: gives an account the `owner` or
 * `member` role.
 *
 * Owner only. Body `{ role: 'owner' | 'member' }`. Idempotent: asking for the
 * role the account has reports `changed: false` and writes nothing. The caller
 * may name their own account; the rules below still apply to it.
 *
 * - Promoting a member makes a second owner, on purpose and only here:
 *   registration never does.
 * - Demoting the only owner is refused with `409 last_owner`, whoever asks.
 * - Two owners demoting each other at once: one succeeds; the other answers
 *   `403 owner_required` (it was demoted while it waited) or `409 last_owner`.
 *
 * The change applies to the affected account's next request. Its sessions are
 * left alone.
 *
 * Responds `200` with `{ user: { id, email, role, createdAt }, previous: { role },
 * changed, changedBy: { id, email }, changedAt }`, `400` for a bad id or body,
 * `401`, `403` (`owner_required`) for a member, `404` for an unknown account and
 * `409` (`last_owner`). Each change is also written to the server log at `info`.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The account administration service.
 */
export function registerSetUserRole(app: FastifyInstance, service: UserAdminService): void {
  app.patch('/api/v1/users/:id/role', async (request) => {
    const caller = await app.requireOwner(request)
    const userId = parseIdParam(request)
    const { role } = parseBody(setUserRoleBody, request.body)

    const result = await service.setRole(caller.id, userId, role)

    if (result.changed) {
      request.log.info(
        { targetUserId: userId, role, previous: result.previousRole, userId: caller.id },
        'account role changed',
      )
    }
    const { user } = result
    return {
      user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
      previous: { role: result.previousRole },
      changed: result.changed,
      changedBy: { id: caller.id, email: caller.email },
      changedAt: new Date().toISOString(),
    }
  })
}
