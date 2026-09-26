import type { FastifyInstance } from 'fastify'
import { parseIdParam } from '../../../http/parseParams.js'
import type { TransactionService } from '../../service/TransactionService.js'

/**
 * Registers `DELETE /api/v1/transactions/:id`: deletes a transaction, or both
 * legs of a transfer.
 *
 * Responds `204` on success, `400` if the id is not a UUID, and `404` if the
 * transaction does not exist.
 */
export function registerDeleteTransaction(app: FastifyInstance, service: TransactionService): void {
  app.delete('/api/v1/transactions/:id', async (request, reply) => {
    const user = await app.requireAuth(request)
    await service.remove(user.id, parseIdParam(request))
    return reply.code(204).send()
  })
}
