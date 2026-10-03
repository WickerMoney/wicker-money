import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { occurrenceParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `GET /api/v1/recurring-items/:id/occurrences/:date/candidates`:
 * for each leg of the occurrence not yet settled, the transactions that could
 * settle it, best first. Nothing is linked.
 *
 * Responds `200` with `{ today, occurrence, legs }`, or `404`.
 */
export function registerListCandidates(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.get('/api/v1/recurring-items/:id/occurrences/:date/candidates', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date } = parseBody(occurrenceParams, request.params)
    return service.candidates(user.id, id, date)
  })
}
