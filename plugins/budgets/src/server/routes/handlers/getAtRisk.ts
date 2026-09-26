import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'

/**
 * Registers `GET /at-risk`: the current month's lines ranked by how much
 * trouble they are in, for the dashboard widget.
 *
 * Query parameter: `tz` (an IANA time zone used to decide which month is
 * current; defaults to `UTC`).
 *
 * Responds `200`. When the current month has no lines the body is
 * `{ monthKey, today, planned: false, lines: [] }`; otherwise it carries the
 * ranked lines, their total count and a spent/available summary.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerGetAtRisk({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('GET', '/at-risk', async ({ userId, query }) => service.getAtRisk(userId, query['tz'] ?? 'UTC'))
}
