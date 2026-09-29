import type { FastifyInstance } from 'fastify'
import type { RecurringItemService } from '../../../recurring/service/RecurringItemService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/recurring-items/list`: the user's active
 * recurring items with their legs and derived `nextDue`, for plugins.
 *
 * Requires a `recurring_items` grant (which covers the legs). Same shape as
 * the host's `GET /api/v1/recurring-items`, including the `today` everything
 * was computed against, so a widget never works out "today" from the browser
 * clock. Responds `200` with `{ today, items }`; `403` without the grant.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The recurring item service.
 * @param needRecurring - Guard that enforces the `recurring_items` grant.
 */
export function registerListRecurringItemsForPlugins(
  app: FastifyInstance,
  service: RecurringItemService,
  needRecurring: TableGrantGuard,
): void {
  app.get('/api/v1/core/recurring-items/list', async (request) => {
    const { userId } = await needRecurring(request)
    return service.list(userId)
  })
}
