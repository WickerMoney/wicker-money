import type { FastifyInstance } from 'fastify'
import type { ReportService } from '../../service/ReportService.js'
import type { TableGrantGuard } from '../helpers/TableGrantGuard.js'

/**
 * Registers `GET /api/v1/core/transactions/monthly-summary`: income and expense
 * per month per category, transfers excluded.
 *
 * Requires a `transactions` grant. The optional `months` query parameter is
 * clamped to 1-36 and defaults to 12. The current month is decided in the
 * user's own time zone, and a split transaction is attributed to its split
 * categories. Responds `200` with `{ months, rows }`, where `total` is a
 * numeric string and an uncategorized row is named `Uncategorized`; `403` if
 * the calling plugin lacks the grant.
 *
 * Both series are returned, because a chart of spending alone cannot answer
 * the question people actually have: whether a month was up or down. Filtering
 * to negative amounts would drop income entirely and also drop refunds, so a
 * month's spending would read as the gross rather than the net.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The report service.
 * @param needTransactions - Guard that enforces the `transactions` grant.
 */
export function registerGetMonthlySummary(
  app: FastifyInstance,
  service: ReportService,
  needTransactions: TableGrantGuard,
): void {
  app.get('/api/v1/core/transactions/monthly-summary', async (request) => {
    const { userId } = await needTransactions(request)
    const months = Number((request.query as { months?: string })?.months ?? 12) || 12
    return service.monthlySummary(userId, months)
  })
}
