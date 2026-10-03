import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { matchBody } from '../schemas/matchBody.js'
import { occurrenceParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `POST /api/v1/recurring-items/:id/occurrences/:date/matches`:
 * records that a transaction settled one leg of the occurrence (and the other
 * side of a transfer, when it is on the item's other leg).
 *
 * Responds `200` with the occurrence; `400` when the transaction is on an
 * account the item does not use or goes the other way; `404`; or `409` with
 * `already_matched`, `leg_matched` or `occurrence_skipped`.
 */
export function registerMatchOccurrence(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.post('/api/v1/recurring-items/:id/occurrences/:date/matches', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date } = parseBody(occurrenceParams, request.params)
    const { transactionId } = parseBody(matchBody, request.body)
    return service.match(user.id, id, date, transactionId)
  })
}
