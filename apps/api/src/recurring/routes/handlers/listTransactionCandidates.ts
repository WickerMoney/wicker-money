import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { transactionParams } from '../schemas/transactionMatchesQuery.js'

/**
 * Registers `GET /api/v1/recurring-items/transaction-matches/:transactionId`:
 * the occurrences one transaction could settle, best first, for picking a
 * different one than suggested. Nothing is linked.
 *
 * Responds `200` with `{ today, transactionId, linked, candidates }`, or `404`.
 */
export function registerListTransactionCandidates(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.get('/api/v1/recurring-items/transaction-matches/:transactionId', async (request) => {
    const user = await app.requireAuth(request)
    const { transactionId } = parseBody(transactionParams, request.params)
    return service.transactionCandidates(user.id, transactionId)
  })
}
