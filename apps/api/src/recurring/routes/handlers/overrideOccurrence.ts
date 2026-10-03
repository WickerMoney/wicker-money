import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { occurrenceOverrideBody } from '../schemas/occurrenceOverrideBody.js'
import { occurrenceParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `PUT /api/v1/recurring-items/:id/occurrences/:date`: records how
 * one occurrence differs from its series (skipped, moved, different amounts),
 * replacing what was recorded. An empty body puts it back to the series.
 *
 * Responds `200` with the occurrence, `400` if the body breaks a rule, `404`,
 * or `409 occurrence_matched` when skipping one a transaction settles.
 */
export function registerOverrideOccurrence(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.put('/api/v1/recurring-items/:id/occurrences/:date', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date } = parseBody(occurrenceParams, request.params)
    const body = parseBody(occurrenceOverrideBody, request.body ?? {})
    return service.override(user.id, id, date, body)
  })
}
