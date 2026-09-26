import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { splitTransactionBody } from '../schemas/splitTransactionBody.js'

/**
 * Registers `PUT /api/v1/transactions/:id/splits`: replaces a transaction's
 * splits with the supplied set and flags the transaction as split.
 *
 * The parts must all share the transaction's sign and sum to its amount
 * exactly. A transfer leg cannot be split.
 *
 * Responds `200` with the inserted split rows. Responds `400` if the body or id
 * is invalid, the parts have mixed signs or do not total the transaction's
 * amount, the transaction is a transfer leg, or a category is not the caller's,
 * and `404` if the transaction does not exist.
 */
export function registerReplaceTransactionSplits(app: FastifyInstance, service: TransactionService): void {
  app.put('/api/v1/transactions/:id/splits', async (request) => {
    const user = await app.requireAuth(request)
    const id = parseIdParam(request)
    const body = parseBody(splitTransactionBody, request.body)
    return service.replaceSplits(user.id, id, body.splits)
  })
}
