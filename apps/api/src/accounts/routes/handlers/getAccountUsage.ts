import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'

/**
 * Registers `GET /api/v1/accounts/:id/usage`: how many rows reference an
 * account, and therefore whether it can be deleted.
 *
 * Both `account_id` and `transfer_account_id` references are counted, so the
 * counterpart leg of a transfer (which may live on a different account's row)
 * is included. Responds `404` if the account does not exist.
 */
export function registerGetAccountUsage(app: FastifyInstance, service: AccountService): void {
  app.get('/api/v1/accounts/:id/usage', async (request) => {
    const user = await app.requireAuth(request)
    return service.usage(user.id, parseIdParam(request))
  })
}
