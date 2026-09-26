import type { FastifyInstance } from 'fastify'
import type { ReportService } from '../../service/ReportService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/accounts/list`: the accounts a plugin may write
 * to or report on.
 *
 * Requires an `accounts` grant. Names and ids only, with no balances: an
 * importer needs to know where to put a statement, not what is in the account,
 * and a grant should hand over the narrowest thing that does the job.
 * Archived accounts are excluded. Responds `200` with `{ accounts }`, each
 * `{ id, name, type }`; `403` if the calling plugin lacks the grant.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The report service.
 * @param needAccounts - Guard that enforces the `accounts` grant.
 */
export function registerListAccounts(
  app: FastifyInstance,
  service: ReportService,
  needAccounts: TableGrantGuard,
): void {
  app.get('/api/v1/core/accounts/list', async (request) => {
    const { userId } = await needAccounts(request)
    return { accounts: await service.listAccounts(userId) }
  })
}
