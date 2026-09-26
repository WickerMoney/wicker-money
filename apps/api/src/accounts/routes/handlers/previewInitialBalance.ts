import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { AccountService } from '../../service/AccountService.js'
import { initialBalanceBody } from '../schemas/initialBalanceBody.js'

/**
 * Registers `POST /api/v1/accounts/:id/initial-balance/preview`: reports what
 * changing the opening balance would do to the derived balance, without
 * changing anything.
 *
 * Editing the opening balance moves every balance the account has ever
 * reported, which is why this flow is separate from the general account
 * update. Responds `404` if the account does not exist.
 */
export function registerPreviewInitialBalance(app: FastifyInstance, service: AccountService): void {
  app.post('/api/v1/accounts/:id/initial-balance/preview', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(initialBalanceBody, request.body)
    return service.previewInitialBalance(user.id, id, body.initialBalance)
  })
}
