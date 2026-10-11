import type { FastifyInstance } from 'fastify'
import type { EraseService } from '../../service/EraseService.js'

/**
 * Registers `GET /api/v1/settings/erase-instance`: what an owner is told
 * before confirming "erase this instance". Which database this is, whether
 * registration is open, which address (if any) `BOOTSTRAP_OWNER_EMAIL` allows to
 * become the owner afterwards, how many other sessions and accounts are live,
 * and a `blocker` when the erase would leave an instance nobody could set up
 * again. Changes nothing.
 *
 * Owner only: `401` without a token, `403` (`owner_required`) for a member.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The erase service.
 */
export function registerGetInstanceEraseCheck(app: FastifyInstance, service: EraseService): void {
  app.get('/api/v1/settings/erase-instance', async (request) => {
    const user = await app.requireOwner(request)
    return service.check(user)
  })
}
