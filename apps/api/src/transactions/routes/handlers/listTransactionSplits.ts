import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'

/**
 * Registers `GET /api/v1/transactions/:id/splits`: lists a transaction's split
 * rows.
 *
 * Responds `200` with an array, empty when the transaction has no splits.
 * Responds `400` if the id is not a UUID and `404` if the transaction does not
 * exist or belongs to someone else.
 */
export function registerListTransactionSplits(app: FastifyInstance, service: TransactionService): void {
  app.get('/api/v1/transactions/:id/splits', async (request) => {
    const user = await app.requireAuth(request)
    return service.listSplits(user.id, parseIdParam(request))
  })
}
