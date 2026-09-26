import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'

/**
 * Registers `DELETE /api/v1/transactions/:id/splits`: removes all of a
 * transaction's splits so its amount can be edited again.
 *
 * Responds `204` on success (also when there were no splits), `400` if the id
 * is not a UUID, and `404` if the transaction does not exist.
 */
export function registerRemoveTransactionSplits(app: FastifyInstance, service: TransactionService): void {
  app.delete('/api/v1/transactions/:id/splits', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.removeSplits(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
