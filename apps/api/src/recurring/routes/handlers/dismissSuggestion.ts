import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { matchBody } from '../schemas/matchBody.js'
import { occurrenceParams } from '../schemas/occurrenceParams.js'

/**
 * Registers `POST /api/v1/recurring-items/:id/occurrences/:date/dismissals`:
 * the transaction is not this occurrence, so the pair is never suggested
 * again (with the other row of a transfer on the item's other leg). Doing it
 * twice is harmless.
 *
 * Responds `200` with `{ itemId, nominalDate, transactionIds }`; `400` when
 * the transaction is on an account the item does not use; `404`; or `409`
 * `already_matched` when the transaction settles this occurrence.
 */
export function registerDismissSuggestion(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.post('/api/v1/recurring-items/:id/occurrences/:date/dismissals', async (request) => {
    const user = await app.requireAuth(request)
    const { id, date } = parseBody(occurrenceParams, request.params)
    const { transactionId } = parseBody(matchBody, request.body)
    return service.dismiss(user.id, id, date, transactionId)
  })
}
