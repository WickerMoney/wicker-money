import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'
import { occurrencesQuery } from '../schemas/occurrencesQuery.js'

/**
 * Registers `GET /api/v1/recurring-items/occurrences?from&to`: every
 * occurrence of every item in the half-open range `[from, to)`.
 *
 * `from` defaults to the user's today and `to` to 31 days later; the range may
 * span at most 400 days. Responds `200` with `{ today, from, to, occurrences }`.
 */
export function registerListOccurrences(app: FastifyInstance, service: RecurringItemService): void {
  app.get('/api/v1/recurring-items/occurrences', async (request) => {
    const user = await app.requireAuth(request)
    return service.occurrences(user.id, parseBody(occurrencesQuery, request.query ?? {}))
  })
}
