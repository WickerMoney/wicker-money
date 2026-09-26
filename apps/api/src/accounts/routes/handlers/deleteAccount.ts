import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'

/**
 * Registers `DELETE /api/v1/accounts/:id`: deletes an account that nothing
 * references.
 *
 * Responds `204` on success, `404` if the account does not exist, and `409`
 * (`account_in_use`) explaining what is using it and naming the alternatives:
 * archive it, delete it with its history, or migrate its history elsewhere.
 */
export function registerDeleteAccount(app: FastifyInstance, service: AccountService): void {
  app.delete('/api/v1/accounts/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.delete(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
