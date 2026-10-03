import type { FastifyInstance } from 'fastify'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'

/**
 * Registers `GET /api/v1/recurring-items/suggestions`: for occurrences
 * expected from two weeks ago to a few days ahead, the transaction most
 * likely to have settled each unsettled leg. Suggestions only; confirming
 * one is a `POST .../matches`.
 *
 * Responds `200` with `{ today, suggestions }`.
 */
export function registerListSuggestions(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.get('/api/v1/recurring-items/suggestions', async (request) => {
    const user = await app.requireAuth(request)
    return service.suggestions(user.id)
  })
}
