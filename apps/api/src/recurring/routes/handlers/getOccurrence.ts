import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { occurrenceParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `GET /api/v1/recurring-items/:id/occurrences/:date`: one
 * occurrence, by its nominal date, and where it stands.
 *
 * Responds `200` with the occurrence, or `404` when the item does not exist
 * or its schedule has no occurrence on that date.
 */
export function registerGetOccurrence(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.get('/api/v1/recurring-items/:id/occurrences/:date', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date } = parseBody(occurrenceParams, request.params)
    return service.get(user.id, id, date)
  })
}
