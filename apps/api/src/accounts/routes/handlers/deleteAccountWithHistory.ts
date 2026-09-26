import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { confirmCountBody } from '../schemas/confirmCountBody.js'

/**
 * Registers `POST /api/v1/accounts/:id/delete-with-history`: deletes an
 * account and every transaction or recurring item that touches it, including
 * the sibling leg of a transfer living on a different account.
 *
 * The body's `confirmCount` must equal the account's current usage total or
 * the request is refused with `409` (`usage_changed`). Responds `404` if the
 * account does not exist and `200` with the number of rows deleted otherwise.
 */
export function registerDeleteAccountWithHistory(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/delete-with-history', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(confirmCountBody, request.body)
    return service.deleteWithHistory(user.id, id, body.confirmCount)
  })
}
