import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { requireMonth } from '../helpers/requireMonth.js'

/**
 * Registers `GET /month`: one month's lines, what has been spent against them,
 * and what was spent without being budgeted.
 *
 * Query parameters: `month` (`YYYY-MM`, required) and `tz` (an IANA time zone
 * used to decide what "today" is; defaults to `UTC`).
 *
 * The request performs no writes. When the month has no lines yet, the
 * previous month's are returned as a draft with no ids.
 *
 * Responds `200` with the month, its lines, unbudgeted spending and a summary,
 * or `400 bad_month` when `month` is missing or malformed.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerGetMonth({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('GET', '/month', async ({ userId, query }) =>
    service.getMonth(userId, requireMonth(query['month']), query['tz'] ?? 'UTC'),
  )
}
