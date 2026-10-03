import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import { forecastQuery } from '../../../recurring/routes/schemas/forecastQuery.js'
import type { RecurringItemService } from '../../../recurring/service/RecurringItemService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/recurring-items/forecast?accountId&horizon`:
 * one account's projected daily balance from its recurring items, for the
 * forecast page.
 *
 * `horizon` is `30d`, `60d`, `90d` (default), `6m` or `eoy`, resolved against
 * the user's today on the server. `accountId` defaults to the first spendable
 * checking account. Needs `recurring_items` and `accounts` grants, like the
 * upcoming outlook, because the projection starts from the account's balance
 * and buffer. Responds `200` with `{ today, horizon, window, accounts,
 * account, days, stats, entries, hasItems }`; `400` for a bad query; `403` if
 * either grant is missing; `404` if `accountId` is not one of the user's
 * active accounts.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The recurring item service.
 * @param needRecurring - Guard that enforces the `recurring_items` grant.
 * @param needAccounts - Guard that enforces the `accounts` grant.
 */
export function registerGetRecurringForecast(
  app: FastifyInstance,
  service: RecurringItemService,
  needRecurring: TableGrantGuard,
  needAccounts: TableGrantGuard,
): void {
  app.get('/api/v1/core/recurring-items/forecast', async (request) => {
    const { userId } = await needRecurring(request)
    await needAccounts(request)
    return service.forecast(userId, parseBody(forecastQuery, request.query ?? {}))
  })
}
