import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { readLineInput } from '../helpers/readLineInput.js'

/**
 * Registers `PUT /line`: creates or updates one budget line.
 *
 * Body: `month` (`YYYY-MM`), `categoryId` (UUID), `planned` (non-negative
 * decimal string), and optionally `rollover` (boolean) and `note` (text,
 * truncated to 300 characters).
 *
 * Responds `200` with `{ id, categoryId, planned, rollover }`. Responds `400`
 * for an invalid body (`bad_body`, `bad_month`, `bad_category`, `bad_planned`
 * or `bad_note`) and `500 not_saved` if the write returns no row.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerUpsertLine({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('PUT', '/line', async ({ userId, body }) => service.upsertLine(userId, readLineInput(body)))
}
