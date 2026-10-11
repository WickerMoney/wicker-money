import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { clearRefreshCookie } from '../../../auth/routes/helpers/clearRefreshCookie.js'
import type { AuthPolicy } from '../../../auth/service/AuthPolicy.js'
import { parseBody } from '../../../http/parseBody.js'
import type { EraseService } from '../../service/EraseService.js'
import { eraseInstanceBody } from '../schemas/eraseBody.js'

/**
 * Registers `POST /api/v1/settings/erase-instance`: deletes every account and
 * empties every plugin schema, leaving an instance that can register a first
 * owner again. Instance configuration (which plugins are on) is kept.
 *
 * Owner only. Body `{ password, confirmation, acknowledgeActiveSessions? }`:
 * the owner's password again, the phrase `erase this instance`, and `true` to
 * go ahead although other sessions are live. Responds `204` and clears the
 * refresh cookie; `400` for the wrong phrase; `401`; `403` (`owner_required`)
 * for a member or (`password_incorrect`) for a wrong password; `409` with code
 * `active_sessions` while other sessions are live and not acknowledged,
 * `registration_disabled` or `bootstrap_owner_mismatch` when the erased
 * instance could not be set up again; `429` past the per-user attempt limit.
 * Nothing is deleted unless the response is `204`.
 *
 * @param app - The Fastify instance to register the route on; needs `@fastify/rate-limit` and `@fastify/cookie`.
 * @param service - The erase service.
 * @param policy - Supplies the refresh-cookie attributes.
 * @param limit - The per-user attempt limiter.
 */
export function registerEraseInstance(
  app: FastifyInstance,
  service: EraseService,
  policy: AuthPolicy,
  limit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): void {
  app.post('/api/v1/settings/erase-instance', async (request, reply) => {
    const user = await app.requireOwner(request)
    await limit(request, reply)
    const body = parseBody(eraseInstanceBody, request.body)
    await service.eraseInstance(user, body)
    request.log.warn({ userId: user.id }, 'instance erased')
    clearRefreshCookie(reply, policy)
    return reply.code(204).send()
  })
}
