import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { occurrencesQuery } from '../../../recurring/routes/schemas/occurrencesQuery.js'
import type { RecurringItemService } from '../../../recurring/service/RecurringItemService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/recurring-items/occurrences?from&to`: every
 * occurrence in the half-open range `[from, to)`, for plugins.
 *
 * Requires a `recurring_items` grant. `from` defaults to the user's today and
 * `to` to 31 days later. Responds `200` with `{ today, from, to, occurrences }`;
 * `403` without the grant.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The recurring item service.
 * @param needRecurring - Guard that enforces the `recurring_items` grant.
 */
export function registerListRecurringOccurrencesForPlugins(
  app: FastifyInstance,
  service: RecurringItemService,
  needRecurring: TableGrantGuard,
): void {
  app.get('/api/v1/core/recurring-items/occurrences', async (request) => {
    const { userId } = await needRecurring(request)
    return service.occurrences(userId, parseBody(occurrencesQuery, request.query ?? {}))
  })
}
