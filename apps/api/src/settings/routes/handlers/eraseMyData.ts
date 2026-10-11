import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { clearRefreshCookie } from '../../../auth/routes/helpers/clearRefreshCookie.js'
import type { AuthPolicy } from '../../../auth/service/AuthPolicy.js'
import { parseBody } from '../../../http/parseBody.js'
import type { EraseService } from '../../service/EraseService.js'
import { eraseMyDataBody } from '../schemas/eraseBody.js'

/**
 * Registers `POST /api/v1/settings/erase-my-data`: deletes everything the
 * signed-in user owns, in `core` and in every bundled plugin's schema, deletes
 * all of their sessions and puts the setup wizard back. The account itself
 * (email, password, role, time zone) stays, so they can sign straight back in
 * to an empty ledger.
 *
 * Body `{ password, confirmation }`: the account password again and the phrase
 * `erase my data`. Responds `204` and clears the refresh cookie, so the client
 * is signed out; `400` (`validation_failed`, issue on `confirmation`) for the
 * wrong phrase; `401` without a valid token; `403` (`password_incorrect`, issue
 * on `password`) for a wrong password, deliberately not a `401` so a typo does
 * not read as an expired session; `429` past the per-user attempt limit. A
 * failure part-way changes nothing.
 *
 * @param app - The Fastify instance to register the route on; needs `@fastify/rate-limit` and `@fastify/cookie`.
 * @param service - The erase service.
 * @param policy - Supplies the refresh-cookie attributes.
 * @param limit - The per-user attempt limiter.
 */
export function registerEraseMyData(
  app: FastifyInstance,
  service: EraseService,
  policy: AuthPolicy,
  limit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): void {
  app.post('/api/v1/settings/erase-my-data', async (request, reply) => {
    const user = await app.requireAuth(request)
    await limit(request, reply)
    const body = parseBody(eraseMyDataBody, request.body)
    const { rows } = await service.eraseMyData(user.id, body)
    request.log.info({ userId: user.id, rows }, 'user data erased')
    clearRefreshCookie(reply, policy)
    return reply.code(204).send()
  })
}
