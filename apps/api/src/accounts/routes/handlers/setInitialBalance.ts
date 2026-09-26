import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { present } from '../helpers/present.js'
import { initialBalanceBody } from '../schemas/initialBalanceBody.js'

/**
 * Registers `POST /api/v1/accounts/:id/initial-balance`: replaces an account's
 * opening balance and returns the account with its recomputed balance.
 *
 * Responds `400` if the body is invalid and `404` if the account does not
 * exist.
 */
export function registerSetInitialBalance(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/initial-balance', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(initialBalanceBody, request.body)
    return present(await service.setInitialBalance(user.id, id, body.initialBalance))
  })
}
