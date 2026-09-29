import type { FastifyInstance } from 'fastify'
import type { RecurringItemService } from '../../../recurring/service/RecurringItemService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/recurring-items/upcoming`: what is due before
 * the next payday, and whether each checking account gets there above its
 * buffer, for the upcoming widget.
 *
 * Needs both a `recurring_items` and an `accounts` grant, because the answer
 * is built from account balances and buffers as well as the items. Everything
 * is computed on the server against the user's today (see
 * `RecurringItemService.upcoming`), so the widget only renders. Responds `200`
 * with `{ today, window, safeToSpend, accounts, occurrences, hasItems }`;
 * `403` if either grant is missing.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The recurring item service.
 * @param needRecurring - Guard that enforces the `recurring_items` grant.
 * @param needAccounts - Guard that enforces the `accounts` grant.
 */
export function registerGetRecurringUpcoming(
  app: FastifyInstance,
  service: RecurringItemService,
  needRecurring: TableGrantGuard,
  needAccounts: TableGrantGuard,
): void {
  app.get('/api/v1/core/recurring-items/upcoming', async (request) => {
    const { userId } = await needRecurring(request)
    await needAccounts(request)
    return service.upcoming(userId)
  })
}
