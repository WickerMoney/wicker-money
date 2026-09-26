import type { FastifyInstance } from 'fastify'
import type { ReportService } from '../../service/ReportService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/accounts/summary`: how many active accounts the
 * user has.
 *
 * Requires an `accounts` grant. Exists so the refusal path is testable: a
 * plugin without the grant must be refused here even though the user behind it
 * can read the same data through the host's own account routes. Responds `200`
 * with `{ activeAccounts }`; `403` if the calling plugin lacks the grant.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The report service.
 * @param needAccounts - Guard that enforces the `accounts` grant.
 */
export function registerGetAccountsSummary(
  app: FastifyInstance,
  service: ReportService,
  needAccounts: TableGrantGuard,
): void {
  app.get('/api/v1/core/accounts/summary', async (request) => {
    const { userId } = await needAccounts(request)
    return { activeAccounts: await service.countActiveAccounts(userId) }
  })
}
