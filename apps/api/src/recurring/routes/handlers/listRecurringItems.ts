import type { FastifyInstance } from 'fastify'
import type { RecurringItemService } from '../../service/RecurringItemService.js'

/**
 * Registers `GET /api/v1/recurring-items`: the user's recurring items with
 * their derived `nextDue`, `amount` and `monthlyEquivalent`, and the `today`
 * they were computed for.
 *
 * Items with nothing left to occur are omitted unless `includeEnded=true`.
 * Responds `200` with `{ today, items }`.
 */
export function registerListRecurringItems(app: FastifyInstance, service: RecurringItemService): void {
  app.get('/api/v1/recurring-items', async (request) => {
    const user = await app.requireAuth(request)
    const includeEnded = (request.query as { includeEnded?: string })?.includeEnded === 'true'
    return service.list(user.id, includeEnded)
  })
}
