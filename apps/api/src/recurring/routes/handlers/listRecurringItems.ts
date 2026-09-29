import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringItemService } from '../../service/RecurringItemService.js'
import { listRecurringItemsQuery } from '../schemas/listRecurringItemsQuery.js'

/**
 * Registers `GET /api/v1/recurring-items`: the user's recurring items with
 * their derived `nextDue`, `amount` and `monthlyEquivalent`, and the `today`
 * they were computed for.
 *
 * Items with nothing left to occur are omitted unless `includeEnded=true`;
 * `accountId` narrows the list to items with a leg on that account. Responds
 * `200` with `{ today, items }`, or `400` for a malformed `accountId`.
 */
export function registerListRecurringItems(app: FastifyInstance, service: RecurringItemService): void {
  app.get('/api/v1/recurring-items', async (request) => {
    const user = await app.requireAuth(request)
    const { includeEnded, accountId } = parseBody(listRecurringItemsQuery, request.query ?? {})
    return service.list(user.id, { includeEnded: includeEnded === 'true', accountId })
  })
}
