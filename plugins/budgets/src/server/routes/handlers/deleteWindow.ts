import type { BudgetService } from '../../service/BudgetService.js'
import type { BudgetRouteDeps } from '../helpers/BudgetRouteDeps.js'
import { requireWindowId } from '../helpers/requireWindowId.js'

/**
 * Registers `DELETE /window`: removes one window.
 *
 * Query parameter: `id` (UUID).
 *
 * Responds `200` with `{ removed }`. Responds `404 not_found` when the caller
 * has no such window, which includes another user's window and a monthly
 * line's id, and `400 bad_id` for a malformed id.
 *
 * @param deps - The host's route registrar.
 * @param service - The budgets service.
 */
export function registerDeleteWindow({ route }: Pick<BudgetRouteDeps, 'route'>, service: BudgetService): void {
  route('DELETE', '/window', async ({ userId, query }) => service.deleteWindow(userId, requireWindowId(query['id'])))
}
