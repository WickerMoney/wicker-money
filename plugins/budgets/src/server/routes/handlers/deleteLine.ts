import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { requireMonth } from '../helpers/requireMonth.js'
import { requireUuid } from '../helpers/requireUuid.js'

/**
 * Registers `DELETE /line`: removes one category's budget line for a month.
 *
 * Query parameters: `month` (`YYYY-MM`) and `categoryId` (UUID).
 *
 * Responds `200` with `{ removed }`, the number of rows deleted. Responds
 * `404 not_found` when the caller has no such line, which includes a line
 * that belongs to another user, and `400` with `bad_month` or `bad_category`
 * for an invalid parameter.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerDeleteLine({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('DELETE', '/line', async ({ userId, query }) =>
    service.deleteLine(
      userId,
      requireMonth(query['month']),
      requireUuid(query['categoryId'], 'categoryId'),
    ),
  )
}
