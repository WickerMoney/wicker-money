import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'

/**
 * Registers `GET /api/v1/accounts/:id`: returns one account with its derived
 * balance, archived or not.
 *
 * Responds `404` if the account does not exist.
 */
export function registerGetAccount(app: FastifyInstance, service: AccountService): void {
  app.get('/api/v1/accounts/:id', async (request) => {
    const user = await app.requireAuth(request)
    return present(await service.get(user.id, parseIdParam(request)))
  })
}
