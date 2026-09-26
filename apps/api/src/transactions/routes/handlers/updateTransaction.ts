import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { updateTransactionBody } from '../schemas/updateTransactionBody.js'

/**
 * Registers `PATCH /api/v1/transactions/:id`: edits a transaction.
 *
 * A transfer leg cannot gain a category, and an amount or date edit on one leg
 * propagates to its sibling. A transfer leg's amount must keep its sign. The
 * amount of a split transaction cannot change. Setting a category records
 * source `manual`; clearing it clears the source.
 *
 * Responds `200` with the updated row. Responds `400` if the id or body is
 * invalid, the body carries `transferAccountId`, sets a category on a transfer
 * leg, names a category that is not the caller's, or flips or zeroes a
 * transfer leg's amount; `404` if the transaction does not exist; and `409`
 * with code `split_amount_locked` if the amount of a split transaction would
 * change.
 */
export function registerUpdateTransaction(app: FastifyInstance, service: TransactionService): void {
  app.patch('/api/v1/transactions/:id', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(updateTransactionBody, request.body)
    return service.update(user.id, id, body)
  })
}
