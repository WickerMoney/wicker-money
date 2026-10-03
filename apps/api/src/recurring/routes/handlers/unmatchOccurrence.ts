import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { matchParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `DELETE /api/v1/recurring-items/:id/occurrences/:date/matches/:transactionId`:
 * the transaction no longer settles the occurrence. The transaction itself is
 * unchanged.
 *
 * Responds `200` with the occurrence, or `404` when the transaction does not
 * settle it.
 */
export function registerUnmatchOccurrence(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.delete('/api/v1/recurring-items/:id/occurrences/:date/matches/:transactionId', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date, transactionId } = parseBody(matchParams, request.params)
    return service.unmatch(user.id, id, date, transactionId)
  })
}
